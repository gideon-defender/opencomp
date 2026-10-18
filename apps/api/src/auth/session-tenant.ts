import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { resolveOidcTenantClaim } from './oidc-tenant-claim';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** Session ownership comes from User; the stored active org is compatibility data. */
export function resolveSessionTenant({
  tenantId,
  activeOrganizationId,
  request,
}: {
  tenantId: unknown;
  activeOrganizationId: unknown;
  request: unknown;
}): string {
  const tenant = resolveOidcTenantClaim({ tenantId }, ['tenantId']);
  if (!tenant.ok || tenant.tenantId !== tenantId) {
    throw new UnauthorizedException('Invalid session tenant ownership');
  }
  if (
    activeOrganizationId != null &&
    activeOrganizationId !== tenant.tenantId
  ) {
    throw new UnauthorizedException(
      'Session organization does not match its tenant',
    );
  }

  const req = recordOf(request);
  const requested = [recordOf(req.headers)['x-organization-id']];
  for (const source of [req.params, req.query, req.body]) {
    const fields = recordOf(source);
    requested.push(fields.organizationId, fields.orgId);
  }
  if (
    requested.some((value) => value !== undefined && value !== tenant.tenantId)
  ) {
    throw new ForbiddenException(
      'Requested organization does not match the session tenant',
    );
  }
  return tenant.tenantId;
}
