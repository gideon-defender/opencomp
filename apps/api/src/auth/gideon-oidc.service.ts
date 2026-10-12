import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { db } from '@db';
import { decodeJwt } from 'jose';
import type { Configuration } from 'openid-client';
import { loadOidcClient } from './gideon-oidc-client';
import { auditOidcEntitlements } from './gideon-oidc-entitlements';
import {
  mintGideonSession,
  provisionGideonUser,
} from './gideon-oidc-provisioning';
import { redisClient } from '../redis/redis.client';

/** Pending-login state TTL: authorize + passkey ceremony must finish in time. */
export const OIDC_STATE_TTL_SECONDS = 10 * 60;

export const OIDC_STATE_KEY_PREFIX = 'app:gideon-oidc:';

/** Loopback hosts where plain-HTTP OIDC discovery is tolerated (local dev). */
function isLoopbackHost(hostname: string): boolean {
  // NOTE: WHATWG URL strips brackets, so IPv6 loopback arrives as `::1`.
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  );
}

export interface BuildLoginUrlParams {
  redirectTo?: string;
  inviteCode?: string;
}

export interface BuiltLoginUrl {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface OidcCallbackResult {
  userId: string;
  email: string;
  sessionToken: string;
  expiresAt: Date;
  redirectTo?: string;
  inviteCode?: string;
}

interface StoredOidcState {
  codeVerifier: string;
  nonce: string;
  redirectTo?: string;
  inviteCode?: string;
}

/**
 * Milestone 1 — Gideon OIDC login (dual-run with better-auth, no deletions).
 *
 * Uses `openid-client` v6 for discovery, PKCE, and the state/nonce/code
 * checks (loaded via `gideon-oidc-client` because the package is ESM-only).
 * Never hand-rolls those with `jose`.
 */
@Injectable()
export class GideonOidcService {
  private readonly logger = new Logger(GideonOidcService.name);
  private config: Configuration | null = null;

  /**
   * The client secret is OPTIONAL: Gideon apps registered as public
   * (`is_public`) have no secret. openid-client v6 then authenticates the
   * code exchange as a public client (`none` + `client_id` in the body),
   * which is safe here because the exchange is server-side and always bound
   * to the PKCE S256 verifier + state/nonce stored in Redis.
   */
  isConfigured(): boolean {
    return !!(
      process.env.GIDEON_IDENTITY_URL &&
      process.env.GIDEON_OIDC_CLIENT_ID &&
      process.env.GIDEON_OIDC_REDIRECT_URI
    );
  }

  private get scopes(): string {
    return process.env.GIDEON_OIDC_SCOPES || 'openid profile email';
  }

  /** Test-only discovery-cache reset. */
  resetCache(): void {
    this.config = null;
  }

  /**
   * OIDC discovery against GIDEON_IDENTITY_URL (cached client config).
   * Plain HTTP is allowed for loopback issuers only (local dev); anything
   * else fails closed instead of leaking the client secret over HTTP.
   */
  async getOidcConfig(): Promise<Configuration> {
    if (this.config) return this.config;

    const identityUrl = process.env.GIDEON_IDENTITY_URL;
    const clientId = process.env.GIDEON_OIDC_CLIENT_ID;
    // Optional — public (`is_public`) Gideon apps have no secret; the
    // library then uses `none` client auth (PKCE-bound, server-side).
    const clientSecret = process.env.GIDEON_OIDC_CLIENT_SECRET || undefined;
    if (!identityUrl || !clientId) {
      throw new UnauthorizedException('Gideon OIDC is not configured');
    }

    const oidc = await loadOidcClient();
    const server = new URL(identityUrl);
    if (server.protocol === 'http:' && !isLoopbackHost(server.hostname)) {
      throw new UnauthorizedException(
        'Gideon OIDC requires HTTPS outside local dev',
      );
    }
    this.config = await oidc.discovery(
      server,
      clientId,
      clientSecret,
      undefined,
      server.protocol === 'http:'
        ? { execute: [oidc.allowInsecureRequests] }
        : undefined,
    );
    this.logger.log(
      `Gideon OIDC discovery complete: ${identityUrl} ` +
        `(client_auth=${clientSecret ? 'client_secret_post' : 'none/public'})`,
    );
    return this.config;
  }

  /**
   * Build the Gideon authorize URL with PKCE S256 + state/nonce.
   * Stores state → { codeVerifier, nonce, redirectTo, inviteCode } in Redis
   * with a ~10 min TTL; the callback rejects mismatched/expired state.
   */
  async buildLoginUrl(
    params: BuildLoginUrlParams = {},
  ): Promise<BuiltLoginUrl> {
    const config = await this.getOidcConfig();
    const oidc = await loadOidcClient();

    const redirectUri = process.env.GIDEON_OIDC_REDIRECT_URI;
    if (!redirectUri) {
      throw new UnauthorizedException('Gideon OIDC is not configured');
    }

    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();

    const stored: StoredOidcState = { codeVerifier, nonce };
    if (params.redirectTo) stored.redirectTo = params.redirectTo;
    if (params.inviteCode) stored.inviteCode = params.inviteCode;
    await redisClient.set(`${OIDC_STATE_KEY_PREFIX}${state}`, stored, {
      ex: OIDC_STATE_TTL_SECONDS,
    });

    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: this.scopes,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    return { url: url.toString(), state, nonce, codeVerifier };
  }

  /**
   * Handle the Gideon redirect: code exchange + nonce validation + userinfo
   * fetch via the library, then find-or-create the user and mint a standard
   * Session row (same shape as better-auth sessions).
   */
  async handleCallback({
    callbackUrl,
  }: {
    callbackUrl: string;
  }): Promise<OidcCallbackResult> {
    const config = await this.getOidcConfig();
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
    const stored = await redisClient.getdel<StoredOidcState>(
      `${OIDC_STATE_KEY_PREFIX}${state}`,
    );
    if (!stored) {
      throw new UnauthorizedException('Invalid or expired login state');
    }

    const redirectUri = process.env.GIDEON_OIDC_REDIRECT_URI;
    if (!redirectUri) {
      throw new UnauthorizedException('Gideon OIDC is not configured');
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
      throw new UnauthorizedException('Incomplete token response from Gideon');
    }

    const userinfo = await oidc.fetchUserInfo(config, tokens.access_token, sub);
    const profile = userinfo as Record<string, unknown>;
    const email = typeof profile.email === 'string' ? profile.email : undefined;
    if (!email) {
      throw new ForbiddenException('Gideon account has no email address');
    }
    if (profile.email_verified !== true) {
      throw new ForbiddenException('Gideon email address is not verified');
    }

    // Tenant is the org: capture the login's tenant id (from the access
    // token) so provisioning stamps it on the user row and the session
    // activates the organization with that id. No org without a tid.
    const tenantId = extractGideonTenantId(tokens.access_token);

    const user = await provisionGideonUser({
      sub,
      email,
      name: typeof profile.name === 'string' ? profile.name : undefined,
      image: typeof profile.picture === 'string' ? profile.picture : undefined,
      tenantId,
    });
    // Phase 0 audit mode: log what Phase 1 enforcement would do, then
    // proceed with the old behavior (mint session, no Member write). Never
    // blocks login; never throws (failures log as audit_error inside).
    await auditOidcEntitlements({ claims, userId: user.id, email, tenantId });
    const session = await mintGideonSession({
      userId: user.id,
      refreshToken:
        typeof tokens.refresh_token === 'string'
          ? tokens.refresh_token
          : undefined,
      tenantId,
    });

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
   * Non-destructive read of the stored return target for a login state.
   * Used only to route failure redirects back to the right app (portal vs
   * app); the state itself stays single-use for the real exchange.
   */
  async peekStoredRedirect(state: string): Promise<string | undefined> {
    try {
      const stored = await redisClient.get<StoredOidcState>(
        `${OIDC_STATE_KEY_PREFIX}${state}`,
      );
      return stored?.redirectTo;
    } catch {
      return undefined;
    }
  }

  /** Revoke the Gideon refresh token, then delete the Session row. */
  async revokeAndDeleteSession(sessionToken: string): Promise<void> {
    const session = await db.session.findUnique({
      where: { token: sessionToken },
      select: { id: true, gideonRefreshToken: true },
    });
    if (!session) return;
    if (session.gideonRefreshToken) {
      await this.revokeToken(session.gideonRefreshToken);
    }
    try {
      await db.session.delete({ where: { id: session.id } });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2025') throw error;
    }
  }
  /** Best-effort revocation against Gideon's /v1/oidc/revoke. */
  private async revokeToken(token: string): Promise<void> {
    try {
      const config = await this.getOidcConfig();
      const oidc = await loadOidcClient();
      await oidc.tokenRevocation(config, token);
    } catch (error) {
      this.logger.warn(
        `Gideon token revocation failed: ${(error as Error).message}`,
      );
    }
  }
}

/**
 * Best-effort Gideon tenant id from an access token (unverified decode —
 * callers must not trust it for authorization, only for org identity:
 * tenant is the org). Accepts the tenant claim shapes Gideon issues (`tid`,
 * `tenant_id`, `organizationId`, `tenantId`). Returns undefined for
 * opaque/undecodable tokens so provisioning proceeds without a tenant.
 */
export function extractGideonTenantId(
  accessToken: string | undefined,
): string | undefined {
  if (!accessToken) return undefined;
  try {
    const payload = decodeJwt(accessToken) as Record<string, unknown>;
    const tid =
      payload.tid ??
      payload.tenant_id ??
      payload.organizationId ??
      payload.tenantId;
    return typeof tid === 'string' && tid ? tid : undefined;
  } catch {
    return undefined;
  }
}
