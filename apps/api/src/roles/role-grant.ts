import { ForbiddenException } from '@nestjs/common';
import { db, type Prisma } from '@db';
import { permissionsGrant, resolveRolePermissions } from '../auth/app-access';
import { resolveServiceByName } from '../auth/service-token.config';
import type { AuthContext as AuthContextType } from '../auth/types';

/**
 * Who is asking to grant permissions via a new or updated role.
 * Resolved callers carry role names; API-key callers carry scopes instead
 * (HybridAuthGuard sets `userRoles` to null for keys and service tokens).
 * Service callers carry the resolved service name for payload-level checks.
 */
export interface RoleGrantCaller {
  roles: string[] | null;
  apiKeyScopes?: string[];
  isServiceToken?: boolean;
  serviceName?: string;
}

/**
 * Narrow the request auth context to what the grant check needs: callers
 * cannot mint roles carrying permissions they do not hold themselves.
 */
export function toGrantCaller(auth: AuthContextType): RoleGrantCaller {
  return {
    roles: auth.userRoles,
    apiKeyScopes: auth.apiKeyScopes,
    isServiceToken: auth.isServiceToken,
    serviceName: auth.serviceName,
  };
}

interface RoleGrantOptions {
  organizationId: string;
  requested: Record<string, string[]>;
  caller?: RoleGrantCaller;
  client?: Pick<Prisma.TransactionClient, 'organizationRole'>;
}

/**
 * Deny granting permissions the caller does not hold. Without this, an
 * `ac:create` holder (e.g. admin, which lacks `organization:delete`) can
 * mint a role carrying permissions above their own and receive it in Gideon.
 * Fail-closed: missing caller context denies the grant, including empty
 * requests that would otherwise skip the check and proceed to a write.
 */
export async function assertCallerMayGrant({
  organizationId,
  requested,
  caller,
  client = db,
}: RoleGrantOptions): Promise<void> {
  if (Object.keys(requested).length === 0) {
    if (!caller) {
      throw new ForbiddenException(
        'Caller context is required to grant permissions',
      );
    }
    return;
  }
  if (!caller) {
    throw new ForbiddenException(
      'Caller context is required to grant permissions',
    );
  }
  // Service tokens are scoped operators: the endpoint guard checks
  // `ac:create`/`ac:update`, and here we check the payload permissions
  // against the service definition so a service cannot mint above itself.
  if (caller.isServiceToken) {
    const service = resolveServiceByName(caller.serviceName);
    if (!service) {
      throw new ForbiddenException(
        'Unknown service — cannot grant permissions',
      );
    }
    const allowed = new Set(service.permissions);
    for (const [resource, actions] of Object.entries(requested)) {
      for (const action of actions) {
        if (!allowed.has(`${resource}:${action}`)) {
          throw new ForbiddenException(
            `Cannot grant "${resource}:${action}" — the service does not hold it`,
          );
        }
      }
    }
    return;
  }
  if (caller.roles) {
    const effective = await resolveRolePermissions(
      organizationId,
      caller.roles,
      client,
    );
    for (const [resource, actions] of Object.entries(requested)) {
      for (const action of actions) {
        if (!permissionsGrant(effective, resource, action)) {
          throw new ForbiddenException(
            `Cannot grant "${resource}:${action}" — the caller does not hold it`,
          );
        }
      }
    }
    return;
  }
  if (caller.apiKeyScopes !== undefined) {
    // Legacy full-access keys carry empty scopes and keep full access,
    // matching the PermissionGuard treatment.
    if (caller.apiKeyScopes.length === 0) return;
    const scopes = new Set(caller.apiKeyScopes);
    for (const [resource, actions] of Object.entries(requested)) {
      for (const action of actions) {
        if (!scopes.has(`${resource}:${action}`)) {
          throw new ForbiddenException(
            `Cannot grant "${resource}:${action}" — the API key does not hold it`,
          );
        }
      }
    }
    return;
  }
  throw new ForbiddenException(
    'Caller does not hold the requested permissions',
  );
}

/**
 * Checked variant of `assertCallerMayGrant` shared by the write services.
 * A custom message only describes what an existing caller lacks — with no
 * caller there is nothing to describe, so the generic fail-closed error
 * applies instead. The portal-only special case keeps the built-in
 * obligations opt-in error specific to the missing portal access.
 */
export async function assertCallerMayGrantChecked({
  message,
  ...options
}: RoleGrantOptions & { message?: string }): Promise<void> {
  const { requested, caller } = options;
  try {
    await assertCallerMayGrant(options);
  } catch (error) {
    if (
      message &&
      caller !== undefined &&
      error instanceof ForbiddenException &&
      requested.portal &&
      Object.keys(requested).length === 1
    ) {
      throw new ForbiddenException(message);
    }
    throw error;
  }
}
