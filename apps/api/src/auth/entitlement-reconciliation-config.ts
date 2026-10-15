import { z } from 'zod';
import {
  oidcClientId,
  oidcEnforcementAllTenants,
  oidcEnforcementTenants,
  oidcIdentityUrl,
  oidcReconciliationEnabled,
  oidcReconciliationPagerdutyKey,
  oidcReconciliationReaderUrl,
  oidcReconciliationReadToken,
  oidcReconciliationSkipPaging,
} from './oidc-env';

// The bootstrap tenant UUID is deliberately not an RFC-versioned UUID.
export const oidcUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export interface EntitlementReconciliationConfig {
  readerUrl: string;
  readerToken: string;
  clientId: string;
  pagerDutyKey?: string;
  tenantIds: string[];
  allTenants?: boolean;
}

/** Off by default. A rollback stops polling without restoring old grants. */
export function reconciliationEnabled(): boolean {
  return oidcReconciliationEnabled();
}

export function readReconciliationConfig(): EntitlementReconciliationConfig {
  const allTenants = oidcEnforcementAllTenants();
  const tenantIds = z.array(oidcUuidSchema).parse([
    ...new Set(
      (allTenants ? '' : oidcEnforcementTenants())
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]);
  const readerUrl = oidcReconciliationReaderUrl() || oidcIdentityUrl();
  const readerToken = oidcReconciliationReadToken();
  const clientId = oidcClientId();
  const pagerDutyKey = oidcReconciliationPagerdutyKey();
  const skipPaging =
    oidcReconciliationSkipPaging() && process.env.GIDEON_ENVIRONMENT === 'dev';
  if (
    !readerUrl ||
    !readerToken?.trim() ||
    !clientId?.trim() ||
    (!skipPaging && !pagerDutyKey?.trim())
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
    pagerDutyKey: skipPaging ? undefined : pagerDutyKey,
    tenantIds,
    allTenants,
  };
}
