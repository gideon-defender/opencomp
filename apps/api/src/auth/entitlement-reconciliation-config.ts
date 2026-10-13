import { z } from 'zod';

// Gideon's bootstrap UUID is deliberately not an RFC-versioned UUID.
export const gideonUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export interface EntitlementReconciliationConfig {
  readerUrl: string;
  readerToken: string;
  clientId: string;
  pagerDutyKey: string;
  tenantIds: string[];
}

/** Off by default. A rollback stops polling without restoring old grants. */
export function reconciliationEnabled(): boolean {
  return process.env.GIDEON_ENTITLEMENTS_RECONCILIATION_ENABLED === 'true';
}

export function readReconciliationConfig(): EntitlementReconciliationConfig {
  const tenantIds = z.array(gideonUuidSchema).parse([
    ...new Set(
      (process.env.GIDEON_ENFORCEMENT_TENANTS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]);
  const readerUrl =
    process.env.GIDEON_ENTITLEMENTS_READER_URL ??
    process.env.GIDEON_IDENTITY_URL;
  const readerToken = process.env.GIDEON_ENTITLEMENTS_READ_TOKEN;
  const clientId = process.env.GIDEON_OIDC_CLIENT_ID;
  const pagerDutyKey = process.env.GIDEON_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY;
  if (
    !readerUrl ||
    !readerToken?.trim() ||
    !clientId?.trim() ||
    !pagerDutyKey?.trim()
  ) {
    throw new Error(
      'Entitlement reconciliation requires reader URL/token, OIDC client ID and PagerDuty routing key',
    );
  }
  const url = new URL(readerUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['https:', 'http:'].includes(url.protocol) ||
    (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
  ) {
    throw new Error(
      'Invalid entitlement reader URL; production requires HTTPS',
    );
  }
  return {
    readerUrl: url.toString().replace(/\/$/, ''),
    readerToken,
    clientId,
    pagerDutyKey,
    tenantIds,
  };
}
