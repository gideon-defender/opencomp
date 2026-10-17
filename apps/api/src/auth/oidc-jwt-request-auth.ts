import { Logger } from '@nestjs/common';
import { db } from '@db';
import { stripControlChars } from './app-access';
import {
  requireOidcBearerAccess,
  resolveTenantLinkedUser,
} from './oidc-mcp-tenant-gate';
import { isJwtShaped, resolveOidcAal } from './oidc-tenant-claim';
import type { AuthenticatedRequest } from './types';
import type { OidcJwtService } from './oidc-jwt.service';
import type { GideonShadowService } from '../gideon/gideon-shadow.service';

/**
 * OIDC JWT verification for the direct Bearer path (precedes the session
 * fallback in `HybridAuthGuard`). Shadow mode falls through to session auth
 * on OIDC verification failure; enforce mode hard-fails tokens from the configured issuer
 * (and JWT-shaped bearers when OIDC is misconfigured or unconfigured).
 * Returns `true` on success, `'enforce_failed'` for a hard 401, or
 * `null` to fall through.
 */
export async function tryOidcJwtAuth({
  request,
  oidcJwtService,
  gideonShadowService,
  logger,
}: {
  request: AuthenticatedRequest;
  oidcJwtService?: OidcJwtService;
  gideonShadowService?: GideonShadowService;
  logger: Logger;
}): Promise<true | 'enforce_failed' | null> {
  const authHeader = request.headers['authorization'] as string | undefined;
  const token =
    authHeader?.startsWith('Bearer ') !== true
      ? null
      : authHeader.slice(7).trim() || null;

  if (!oidcJwtService || !oidcJwtService.isConfigured()) {
    // Enforce mode with no OIDC configuration must not silently fall back:
    // no legitimate OIDC token can exist, and native session bearers are
    // opaque, so JWT-shaped bearers fail closed. Opaque bearers still fall
    // through to session auth.
    if (token && isJwtShaped(token) && oidcJwtService?.isEnforceMode()) {
      logger.warn(
        '[OIDC] JWT-shaped bearer in enforce mode with OIDC unconfigured',
      );
      return 'enforce_failed';
    }
    return null;
  }

  if (!token) return null;

  const result = await oidcJwtService.verify(token);
  if (!result) {
    // Enforce only tokens that present as OIDC JWTs. Anything else
    // (opaque session/MCP bearer tokens, foreign JWTs) falls through to
    // session auth in every mode — dual-run fallback. A partial OIDC
    // configuration (endpoint set, issuer/audience missing) cannot identify
    // tokens, so JWT-shaped bearers also fail closed instead of silently
    // falling back.
    if (
      oidcJwtService.isEnforceMode() &&
      (oidcJwtService.isOidcToken(token) ||
        (oidcJwtService.isMisconfigured() && isJwtShaped(token)))
    ) {
      logger.warn('[OIDC] JWT verify failed in enforce mode');
      return 'enforce_failed';
    }
    logger.debug('[OIDCShadow] JWT verify failed, falling through to session');
    return null;
  }

  const tenantClaim = oidcJwtService.resolveTenantClaim(result.payload);
  const oidcSub = oidcJwtService.resolveUserId(result.payload);
  if (!tenantClaim.ok || !oidcSub) {
    logger.warn(
      `[OIDC] JWT rejected: ${!tenantClaim.ok ? `tenant claim ${tenantClaim.reason}` : 'missing sub'}`,
    );
    if (oidcJwtService.isEnforceMode()) return 'enforce_failed';
    return null;
  }
  const tenantId = tenantClaim.tenantId;

  // The IdP `sub` is not the OpenComp user id (the link lives on
  // `User.oidcSub`, set by OIDC JIT provisioning). An unlinked sub holds
  // no memberships: fall through in shadow, 401 in enforce. The subject link also
  // requires `User.tenantId` to equal the verified tenant (same-email
  // two-tenants isolation) — see `resolveTenantLinkedUser`.
  const link = await resolveTenantLinkedUser({
    sub: oidcSub,
    tenantId,
    logger,
  });
  if (!link.ok) {
    if (oidcJwtService.isEnforceMode()) return 'enforce_failed';
    return null;
  }
  const linkedUser = link.user;
  const userId = linkedUser.id;

  // Verify org exists and user is member (same check as session).
  // Tenant is the org: the token's tid IS the organization id. Unknown
  // tenants and non-members 401 in enforce mode (and fall through in
  // shadow) — no org without a tid.
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  if (!org) {
    logger.warn(
      `[OIDCShadow] unknown OIDC tenant ${stripControlChars(tenantId)} (no such organization)`,
    );
    if (oidcJwtService.isEnforceMode()) return 'enforce_failed';
    return null;
  }

  const member = await db.member.findFirst({
    where: {
      userId,
      organizationId: org.id,
      deactivated: false,
      idpAccessRevoked: false,
    },
    select: { id: true, role: true, department: true },
  });
  if (!member) {
    logger.warn(
      `[OIDCShadow] user ${userId} not member of tenant ${stripControlChars(tenantId)}`,
    );
    if (oidcJwtService.isEnforceMode()) return 'enforce_failed';
    return null;
  }

  // Gram tokens reach this path first; enforce the same access contract before
  // accepting any verified bearer or setting successful-authentication flags.
  await requireOidcBearerAccess({ userId, tenantId, role: member.role });

  request.organizationId = org.id;
  request.userId = userId;
  // The verified payload is attacker-shaped JSON: only trust a string email,
  // otherwise fall back to the linked user row.
  const payloadEmail = result.payload.email;
  request.userEmail =
    typeof payloadEmail === 'string' && payloadEmail
      ? payloadEmail
      : linkedUser.email;
  request.userRoles = member.role ? member.role.split(',') : null;
  request.memberId = member.id;
  request.memberDepartment = member.department;
  request.authType = 'gideon';
  request.isApiKey = false;
  request.isServiceToken = false;
  request.isOidcJwt = true;
  // Surface the assurance level for a future aal >= 2 gate. Absent →
  // unknown. No consumer enforces it yet — treat the value as informational
  // until the cutover adds the check.
  const aal = resolveOidcAal(result.payload.aal);
  if (aal !== undefined) {
    request.oidcAal = aal;
  }

  if (gideonShadowService) {
    // Fire-and-forget shadow comparison for operations
    gideonShadowService
      .logTenantOperationsMismatch(tenantId, token)
      .catch(() => {});
  }

  logger.log(
    `[OIDC] JWT authenticated user ${userId} tenant ${stripControlChars(tenantId)} shadow=${oidcJwtService.isShadowMode()}`,
  );
  return true;
}
