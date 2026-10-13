import { z } from 'zod';
import type { EntitlementReconciliationConfig } from './entitlement-reconciliation-config';
import { gideonUuidSchema } from './entitlement-reconciliation-config';

const snapshotSchema = z.object({
  tenant_id: gideonUuidSchema,
  user_id: gideonUuidSchema,
  client_id: z.string().min(1),
  complete: z.literal(true),
  channel: z.literal('oidc'),
  user_status: z.enum([
    'active',
    'pending_enrollment',
    'suspended',
    'deprovisioned',
    'deleted',
  ]),
  observed_at: z.string().datetime({ offset: true }),
  entitlements: z.array(z.string().min(1)),
});

export type EntitlementSnapshot = z.infer<typeof snapshotSchema>;

/** Missing fields, stale data and lookup failures never mean "no roles". */
export async function fetchEntitlementSnapshot({
  config,
  tenantId,
  subject,
}: {
  config: EntitlementReconciliationConfig;
  tenantId: string;
  subject: string;
}): Promise<EntitlementSnapshot> {
  const startedAt = Date.now();
  const url = new URL(
    `${config.readerUrl}/v1/internal/tenants/${encodeURIComponent(tenantId)}/oidc-entitlements/${encodeURIComponent(subject)}`,
  );
  url.searchParams.set('client_id', config.clientId);
  const response = await fetch(url, {
    headers: {
      'x-entitlements-read-token': config.readerToken,
      'cache-control': 'no-cache',
    },
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
    cache: 'no-store',
  });
  if (!response.ok)
    throw new Error(`IdP entitlement reader failed (HTTP ${response.status})`);
  const snapshot = snapshotSchema.parse(await response.json());
  if (
    snapshot.tenant_id !== tenantId ||
    snapshot.user_id !== subject ||
    snapshot.client_id !== config.clientId
  ) {
    throw new Error('IdP entitlement snapshot scope mismatch');
  }
  const observedAt = Date.parse(snapshot.observed_at);
  if (observedAt < startedAt - 10_000 || observedAt > Date.now() + 10_000) {
    throw new Error('IdP entitlement snapshot is stale or future-dated');
  }
  if (snapshot.user_status !== 'active' && snapshot.entitlements.length > 0) {
    throw new Error('Inactive IdP user returned inconsistent entitlements');
  }
  return snapshot;
}
