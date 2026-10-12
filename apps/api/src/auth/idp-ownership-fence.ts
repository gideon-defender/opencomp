import { GoneException, Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('IdpOwnershipFence');

/**
 * Phase 3 (IdP-owned user management): human membership and role writes are
 * owned by the Gideon identity service. Legacy OpenComp writers stay routed
 * for one release but return 410 Gone with this message (readable for
 * MCP/agent callers) instead of mutating. Phase 4 deletes them.
 */
export const IDP_MANAGED_MESSAGE =
  'User and role management is owned by the Gideon identity service. ' +
  'Manage members, invitations, and role assignments in Gideon — ' +
  'this OpenComp endpoint returns 410 Gone.';

/**
 * Fence for NestJS controllers: guards (401/403) still run first.
 * Returns void (not never) so the fenced handler body left in place for
 * Phase 4 deletion still typechecks below the fence call.
 */
export function throwIdpManagedGone(): void {
  throw new GoneException(IDP_MANAGED_MESSAGE);
}

/**
 * Better Auth organization mutations blocked at the HTTP edge, verified
 * against the installed better-auth organization routes. Reads
 * (`set-active`, `get-full-organization`, `list*`, `get-invitation`, …),
 * team endpoints, and the MCP/session routes are untouched.
 *
 * `organization/create` is included: it implicitly grants a local owner
 * member, and generic org creation must not do that once bootstrap routes
 * through verified IdP assignments (Phase 5 prerequisite).
 */
export const BLOCKED_BETTER_AUTH_PATHS: readonly string[] = [
  '/api/auth/organization/create',
  '/api/auth/organization/invite-member',
  '/api/auth/organization/accept-invitation',
  '/api/auth/organization/reject-invitation',
  '/api/auth/organization/cancel-invitation',
  '/api/auth/organization/update-member-role',
  '/api/auth/organization/remove-member',
  '/api/auth/organization/leave',
  '/api/auth/organization/create-role',
  '/api/auth/organization/update-role',
  '/api/auth/organization/delete-role',
];

/** Exact-match on the path (query stripped, trailing slash tolerated). */
export function isBlockedBetterAuthPath(rawPath: string): boolean {
  const withoutQuery = rawPath.split('?')[0] ?? '';
  const normalized =
    withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') : withoutQuery;
  return BLOCKED_BETTER_AUTH_PATHS.includes(normalized);
}

/**
 * Express middleware (wired in main.ts alongside originCheckMiddleware).
 * Rejects blocked Better Auth mutations with the same 410 body Nest's
 * GoneException produces; everything else passes through untouched.
 */
export function idpMembershipFencesMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isBlockedBetterAuthPath(req.path)) {
    logger.warn(`Blocked legacy membership write: ${req.method} ${req.path}`);
    res.status(410).json({
      statusCode: 410,
      message: IDP_MANAGED_MESSAGE,
      error: 'Gone',
    });
    return;
  }
  next();
}
