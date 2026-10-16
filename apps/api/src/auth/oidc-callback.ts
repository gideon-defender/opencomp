import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { decodeJwt } from 'jose';
import type { Configuration } from 'openid-client';
import { loadOidcClient } from './oidc-client';
import {
  auditOidcEntitlements,
  enforceOidcEntitlements,
  EntitlementsDeniedError,
  parseEntitlementsClaim,
} from './oidc-entitlements';
import { recordBootstrapOwner } from './gideon-bootstrap-authorization';
import {
  enforceBootstrapGate,
  isBootstrapEnforced,
  isEnforcementEnabledFor,
} from './oidc-gates';
import { revokeSsoMember, syncSsoMember } from './sso-member-sync';
import { mintOidcSession, provisionOidcUser } from './oidc-provisioning';
import { collectTenantClaimValues } from './oidc-tenant-claim';
import { oidcRedirectUri, oidcRequireEmailVerified } from './oidc-env';
import { redisClient } from '../redis/redis.client';

/** Pending-login state TTL: authorize + passkey ceremony must finish in time. */
export const OIDC_STATE_TTL_SECONDS = 10 * 60;

export const OIDC_STATE_KEY_PREFIX = 'app:oidc:';

/**
 * Keep writes on this prefix while old API tasks can serve callbacks.
 * Read both prefixes to accept state from either version during rollouts
 * and rollbacks. Switch writes only after all readers support both prefixes.
 */
export const LEGACY_OIDC_STATE_KEY_PREFIX = 'app:gideon-oidc:';

export interface OidcCallbackResult {
  userId: string;
  email: string;
  sessionToken: string;
  expiresAt: Date;
  redirectTo?: string;
  inviteCode?: string;
}

export interface StoredOidcState {
  codeVerifier: string;
  nonce: string;
  redirectTo?: string;
  inviteCode?: string;
}

export async function handleOidcCallback({
  callbackUrl,
  config,
}: {
  callbackUrl: string;
  config: Configuration;
}): Promise<OidcCallbackResult> {
  const oidc = await loadOidcClient();

  let state: string | null = null;
  try {
    state = new URL(callbackUrl).searchParams.get('state');
  } catch {
    state = null;
  }
  if (!state) {
    throw new UnauthorizedException('Missing login state');
  }
  let stored = await redisClient.getdel<StoredOidcState>(
    `${OIDC_STATE_KEY_PREFIX}${state}`,
  );
  if (!stored) {
    stored = await redisClient.getdel<StoredOidcState>(
      `${LEGACY_OIDC_STATE_KEY_PREFIX}${state}`,
    );
  }
  if (!stored) {
    throw new UnauthorizedException('Invalid or expired login state');
  }

  const redirectUri = oidcRedirectUri();
  if (!redirectUri) {
    throw new UnauthorizedException('OIDC login is not configured');
  }

  const tokens = await oidc.authorizationCodeGrant(
    config,
    new URL(callbackUrl),
    {
      pkceCodeVerifier: stored.codeVerifier,
      expectedState: state,
      expectedNonce: stored.nonce,
      idTokenExpected: true,
    },
    { redirect_uri: redirectUri },
  );

  const claims = tokens.claims();
  const sub = claims?.sub;
  if (!sub || !tokens.access_token) {
    throw new UnauthorizedException(
      'Incomplete token response from the identity provider',
    );
  }

  const userinfo = await oidc.fetchUserInfo(config, tokens.access_token, sub);
  const profile = userinfo as Record<string, unknown>;
  // Prefer the userinfo email; fall back to the verified ID-token claims so
  // IdPs that omit email from userinfo still log in (generic-oidc §5.4).
  const idTokenClaims = claims as unknown as Record<string, unknown>;
  const userinfoEmail =
    typeof profile.email === 'string' ? profile.email : undefined;
  const idTokenEmail =
    typeof idTokenClaims.email === 'string' ? idTokenClaims.email : undefined;
  const email = userinfoEmail ?? idTokenEmail;
  if (!email) {
    throw new ForbiddenException('OIDC account has no email address');
  }
  // Policy flag for IdPs that omit `email_verified` (default true preserves
  // the Gideon behavior of denying unverified addresses). Verify the source
  // that supplied the email: IdPs that omit email from userinfo also omit
  // its flag, so the fallback path checks the ID-token flag instead.
  const verificationClaim = userinfoEmail
    ? profile.email_verified
    : idTokenClaims.email_verified;
  const emailVerified = verificationClaim === true;
  if (
    verificationClaim === false ||
    (oidcRequireEmailVerified() && !emailVerified)
  ) {
    throw new ForbiddenException('OIDC email address is not verified');
  }

  // Tenant is the org: capture the login's tenant id (from the access
  // token) so provisioning stamps it on the user row and the session
  // activates the organization with that id. No org without a tid.
  const tenantId = extractOidcTenantId(tokens.access_token);

  const user = await provisionOidcUser({
    sub,
    email,
    emailVerified,
    name: typeof profile.name === 'string' ? profile.name : undefined,
    image: typeof profile.picture === 'string' ? profile.picture : undefined,
    tenantId,
    beforeWrite: async () => {
      if (isBootstrapEnforced() && !isEnforcementEnabledFor(tenantId)) {
        await enforceBootstrapGate({ claims, email, tenantId });
      }
    },
  });
  // Phase 0 audit mode: log what Phase 1 enforcement would do, then
  // proceed with the old behavior (mint session, no Member write). Never
  // blocks login; never throws (failures log as audit_error inside).
  //
  // Phase 1 (pilot): allowlisted tenants enforce — deny mints no session,
  // valid assignments JIT-sync the Member row before the session commits.
  // Identity gates above (email_verified, banned, oidcSub) run first.
  if (isEnforcementEnabledFor(tenantId) && tenantId) {
    const { matched } = await enforceOidcEntitlements({
      claims,
      email,
      tenantId,
    }).catch(async (error: unknown) => {
      if (
        error instanceof EntitlementsDeniedError &&
        (error.reason === 'empty_entitlements' ||
          error.reason === 'no_valid_match')
      ) {
        await revokeSsoMember({ userId: user.id, organizationId: tenantId });
      }
      throw error;
    });
    await syncSsoMember({
      userId: user.id,
      organizationId: tenantId,
      roles: matched,
      ...(user.tenantId && user.tenantId !== tenantId ? { subject: sub } : {}),
    });
  } else {
    await auditOidcEntitlements({ claims, userId: user.id, email, tenantId });
  }
  const session = await mintOidcSession({
    userId: user.id,
    refreshToken:
      typeof tokens.refresh_token === 'string'
        ? tokens.refresh_token
        : undefined,
    tenantId,
  });

  if (
    isBootstrapEnforced() &&
    tenantId &&
    parseEntitlementsClaim(claims).includes('owner')
  ) {
    await recordBootstrapOwner({
      sessionId: session.id,
      userId: user.id,
      tenantId,
      expiresAt: session.expiresAt,
    });
  }

  return {
    userId: user.id,
    email,
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    ...(stored.redirectTo ? { redirectTo: stored.redirectTo } : {}),
    ...(stored.inviteCode ? { inviteCode: stored.inviteCode } : {}),
  };
}

/**
 * Best-effort identity-provider tenant id from an access token (unverified decode —
 * callers must not trust it for authorization, only for org identity:
 * tenant is the org). Accepts the tenant claim shapes the IdP issues (`tid`,
 * `tenant_id`, `organizationId`, `tenantId`). Returns undefined for
 * opaque/undecodable tokens so provisioning proceeds without a tenant.
 *
 * Invalid decoded claims reject before provisioning; they must not downgrade
 * an enforced login into tenant-less audit mode. Opaque tokens retain the
 * existing compatibility path.
 */
export function extractOidcTenantId(
  accessToken: string | undefined,
): string | undefined {
  if (!accessToken) return undefined;
  let payload: Record<string, unknown>;
  try {
    payload = decodeJwt(accessToken);
  } catch {
    return undefined;
  }
  const { seen, malformedKey } = collectTenantClaimValues({ payload });
  if (malformedKey) {
    throw new UnauthorizedException(
      'Invalid identity token: malformed tenant claim',
    );
  }
  if (seen.length === 0) return undefined;
  if (new Set(seen.map((s) => s.value)).size > 1) {
    throw new UnauthorizedException(
      'Invalid identity token: conflicting tenant claims',
    );
  }
  return seen[0].value;
}
