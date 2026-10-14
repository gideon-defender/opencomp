import {
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { db } from '@db';
import { hasAppAccess, stripControlChars } from './app-access';
import { resolveGideonAal } from './gideon-tenant-claim';
import type { AuthenticatedRequest } from './types';
import type { GideonJwtPayload, GideonJwtService } from './gideon-jwt.service';

export interface TenantLinkedUser {
  id: string;
  email: string;
  tenantId: string | null;
}

export type TenantLinkResult =
  | { ok: true; user: TenantLinkedUser }
  | { ok: false; reason: 'unlinked' | 'cross-tenant' };

/**
 * Link a Gideon subject to its OpenComp user through `User.gideonSub` only
 * (never email-global) and require the row's immutable `User.tenantId` to
 * equal the verified token tenant. Shared by the direct Gideon-JWT path and
 * the MCP tenant gate so the two cannot drift.
 */
export async function resolveTenantLinkedUser({
  sub,
  tenantId,
  logger,
}: {
  sub: string;
  tenantId: string;
  logger?: Logger;
}): Promise<TenantLinkResult> {
  const linked = await db.user.findUnique({
    where: { gideonSub: sub },
    select: { id: true, email: true, tenantId: true },
  });
  if (!linked) {
    logger?.warn('[Gideon] MCP token sub not linked to an OpenComp user');
    return { ok: false, reason: 'unlinked' };
  }
  if (!linked.tenantId) {
    // A linked row with no tenant owner is not "owned by a different
    // organization" — treat it as unlinked (401) so the client retries
    // authentication instead of sticking on a misleading 403.
    logger?.warn(
      `[Gideon] MCP token sub linked to tenant-less user ${linked.id}`,
    );
    return { ok: false, reason: 'unlinked' };
  }
  if (linked.tenantId !== tenantId) {
    logger?.warn(
      `[Gideon] MCP cross-tenant subject rejected: user ${linked.id} owned by tenant ${stripControlChars(linked.tenantId ?? '<none>')} presented tenant ${stripControlChars(tenantId)}`,
    );
    return { ok: false, reason: 'cross-tenant' };
  }
  return { ok: true, user: linked };
}

/**
 * Phase 0 tenant gate for a verified Gideon MCP token.
 *
 * Contract (all failures throw — never fall back to legacy):
 * 1. Tenant resolves from verified claims via the strict claim contract
 *    (missing/malformed/conflicting → 401).
 * 2. Subject resolves through `User.gideonSub` only (never email-global);
 *    unlinked → 401.
 * 3. `User.tenantId` must equal the token tenant (cross-tenant subject →
 *    403). The same email in two tenants is two independent User rows.
 * 4. The token tenant must be a known Organization (unknown → 401).
 * 5. A saved `McpOrgBinding` must agree with the token tenant — it may not
 *    override or redirect to another account (stale/conflicting → 403).
 * 6. Active, non-revoked membership in the token org + `app:read` required.
 */
export async function authenticateGideonMcpToken({
  request,
  payload,
  gideonJwtService,
  logger,
}: {
  request: AuthenticatedRequest;
  payload: GideonJwtPayload;
  gideonJwtService: GideonJwtService;
  logger: Logger;
}): Promise<boolean> {
  const tenantClaim = gideonJwtService.resolveTenantClaim(payload);
  if (!tenantClaim.ok) {
    logger.warn(
      `[Gideon] MCP token rejected: tenant claim ${tenantClaim.reason} — ${stripControlChars(tenantClaim.detail)}`,
    );
    throw new UnauthorizedException(
      `Invalid Gideon token: ${tenantClaim.reason} tenant claim`,
    );
  }
  const tenantId = tenantClaim.tenantId;

  const sub = gideonJwtService.resolveUserId(payload);
  if (!sub) {
    logger.warn('[Gideon] MCP token rejected: missing sub claim');
    throw new UnauthorizedException('Invalid Gideon token: missing subject');
  }

  const link = await resolveTenantLinkedUser({ sub, tenantId, logger });
  if (!link.ok) {
    if (link.reason === 'cross-tenant') {
      throw new ForbiddenException(
        'Gideon account belongs to a different organization',
      );
    }
    throw new UnauthorizedException(
      'Gideon account is not linked to an OpenComp user for this tenant',
    );
  }

  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  if (!org) {
    logger.warn(
      `[Gideon] MCP token rejected: unknown tenant ${stripControlChars(tenantId)}`,
    );
    throw new UnauthorizedException('Unknown tenant for Gideon token');
  }

  // Flags are set only after the request populates successfully — a rejected
  // token must not leave Gideon-verified markers on the request.
  const populated = await populateTenantPinnedMcpRequest({
    request,
    userId: link.user.id,
    tenantId,
    logger,
  });
  if (!populated) {
    throw new UnauthorizedException(
      'Gideon account user record is no longer available',
    );
  }
  const aal = resolveGideonAal(payload.aal);
  if (aal !== undefined) {
    request.gideonAal = aal;
  }
  request.isGideonJwt = true;
  return true;
}

/** Direct and hosted-MCP bearers share a verifier, so both must enforce this gate. */
export async function requireGideonBearerAccess({
  userId,
  tenantId,
  role,
}: {
  userId: string;
  tenantId: string;
  role: string;
}): Promise<void> {
  const binding = await db.mcpOrgBinding.findUnique({
    where: { userId },
    select: { organizationId: true },
  });
  if (binding && binding.organizationId !== tenantId) {
    throw new ForbiddenException(
      'Choose an organization you still belong to for AI/MCP access in OpenComp settings, then try again.',
    );
  }
  if (!(await hasAppAccess(tenantId, role))) {
    throw new ForbiddenException(
      "Your role doesn't have access to the app, so it can't use the MCP. " +
        'Ask an organization admin for access.',
    );
  }
}

/** Populate a request only after the verified tenant and access checks pass. */
export async function populateTenantPinnedMcpRequest({
  request,
  userId,
  tenantId,
  logger,
}: {
  request: AuthenticatedRequest;
  userId: string;
  tenantId: string;
  logger: Logger;
}): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) {
    return false;
  }

  const member = await db.member.findFirst({
    where: {
      userId,
      organizationId: tenantId,
      deactivated: false,
      idpAccessRevoked: false,
    },
    select: { id: true, role: true, department: true },
  });
  if (!member) {
    throw new ForbiddenException(
      'This account is not an active member of the token organization, so it cannot use the MCP.',
    );
  }
  await requireGideonBearerAccess({ userId, tenantId, role: member.role });

  request.userId = user.id;
  request.userEmail = user.email;
  request.organizationId = tenantId;
  request.authType = 'session';
  request.isApiKey = false;
  request.isServiceToken = false;
  request.isMcpOAuth = true;
  request.memberId = member.id;
  request.memberDepartment = member.department;
  request.userRoles = member.role ? member.role.split(',') : null;
  logger.log(
    `MCP OAuth token (gideon) authenticated for user ${user.id} (org ${stripControlChars(tenantId)})`,
  );
  return true;
}
