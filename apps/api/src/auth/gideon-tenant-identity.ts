import { normalizeEmail } from '@db';
import { z } from 'zod';
import { gideonUuidSchema } from './entitlement-reconciliation-config';

const lookupSchema = z.object({
  tenant_id: gideonUuidSchema,
  identity: z
    .object({
      id: gideonUuidSchema,
      email: z.string().email(),
      display_name: z.string().nullable(),
      status: z.enum([
        'active',
        'pending_enrollment',
        'suspended',
        'deprovisioned',
      ]),
    })
    .nullable(),
});

/** Resolve a secondary subject without trusting the shared row's primary link. */
export async function lookupGideonTenantIdentity({
  tenantId,
  email,
}: {
  tenantId: string;
  email: string;
}) {
  const base =
    process.env.GIDEON_HR_IDENTITY_URL ||
    process.env.GIDEON_IDENTITY_URL ||
    process.env.AUTH__IDENTITY_URL;
  const token =
    process.env.GIDEON_INTERNAL_SERVICE_TOKEN ||
    process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token)
    throw new Error(
      'Gideon identity lookup requires an identity URL and internal service token',
    );
  const normalized = normalizeEmail(email);
  const url = new URL(
    `${base.replace(/\/$/, '')}/v1/internal/tenants/${encodeURIComponent(tenantId)}/hr-identity`,
  );
  url.searchParams.set('email', normalized);
  const response = await fetch(url, {
    headers: {
      'x-internal-service-token': token,
      'x-gideon-actor': 'opencomp-hr-sync',
    },
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
    cache: 'no-store',
  });
  if (!response.ok)
    throw new Error(`IdP identity lookup failed (HTTP ${response.status})`);
  const result = lookupSchema.parse(await response.json());
  if (
    result.tenant_id !== tenantId ||
    (result.identity && normalizeEmail(result.identity.email) !== normalized)
  ) {
    throw new Error(
      'IdP identity lookup returned a mismatched tenant or email',
    );
  }
  return result.identity;
}
