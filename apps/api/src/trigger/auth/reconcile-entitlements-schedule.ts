import { serviceDb } from '@db';
import { logger, schedules } from '@gideon-defender/trigger-local';
import {
  readReconciliationConfig,
  reconciliationEnabled,
  type EntitlementReconciliationConfig,
} from '../../auth/entitlement-reconciliation-config';
import { reconcileSsoMember } from '../../auth/reconcile-sso-member';
import { reportReconciliationIncident } from './entitlement-reconciliation-alert';

/** Re-read the tenant inventory each run so newly provisioned orgs are covered. */
async function discoverTenantIds(): Promise<string[]> {
  const tenantIds: string[] = [];
  let after: string | undefined;
  while (true) {
    const tenants = await serviceDb.organization.findMany({
      where: after ? { id: { gt: after } } : {},
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    if (tenants.length === 0) return tenantIds;
    tenantIds.push(...tenants.map((tenant) => tenant.id));
    after = tenants[tenants.length - 1].id;
  }
}

/** Poll every five minutes; the next request after reconciliation sees the cutoff. */
export async function runEntitlementReconciliation() {
  if (!reconciliationEnabled()) return { skipped: true, changed: 0, failed: 0 };
  let pagingFailed = 0;
  async function reportIncident(
    incident: Parameters<typeof reportReconciliationIncident>[0],
  ): Promise<void> {
    try {
      await reportReconciliationIncident(incident);
    } catch {
      pagingFailed++;
      logger.error(
        'Entitlement reconciliation paging failed; continuing scan',
        {
          tenantId: incident.tenantId,
        },
      );
    }
  }
  let config: EntitlementReconciliationConfig;
  try {
    config = readReconciliationConfig();
    if (config.allTenants)
      config = { ...config, tenantIds: await discoverTenantIds() };
  } catch {
    const key = process.env.GIDEON_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY;
    if (key)
      await reportIncident({
        tenantId: 'configuration',
        readerHost: 'configuration',
        failures: 1,
        resolved: false,
        routingKey: key,
      });
    throw new Error(
      'Entitlement reconciliation configuration is invalid; no memberships changed',
    );
  }
  let changed = 0;
  let failed = 0;
  for (const tenantId of config.tenantIds) {
    let tenantFailed = 0;
    let after: string | undefined;
    try {
      while (true) {
        const members = await serviceDb.member.findMany({
          where: {
            organizationId: tenantId,
            roleSource: 'sso',
            ...(after ? { id: { gt: after } } : {}),
          },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: 100,
        });
        if (members.length === 0) break;
        for (const member of members) {
          try {
            if (
              (await reconcileSsoMember({
                memberId: member.id,
                tenantId,
                config,
              })) === 'changed'
            )
              changed++;
          } catch {
            tenantFailed++;
            logger.error(
              'Entitlement reconciliation failed; retaining last-known membership',
              { tenantId, memberId: member.id },
            );
            if (tenantFailed === 1)
              await reportIncident({
                tenantId,
                readerHost: new URL(config.readerUrl).host,
                failures: 1,
                resolved: false,
                routingKey: config.pagerDutyKey,
              });
          }
        }
        after = members[members.length - 1].id;
      }
    } catch {
      tenantFailed++;
    }
    failed += tenantFailed;
    await reportIncident({
      tenantId,
      readerHost: new URL(config.readerUrl).host,
      failures: tenantFailed,
      resolved: tenantFailed === 0,
      routingKey: config.pagerDutyKey,
    });
  }
  logger.info('Entitlement reconciliation completed', {
    changed,
    failed,
    pagingFailed,
  });
  if (failed > 0 || pagingFailed > 0)
    throw new Error(
      `Entitlement reconciliation failed for ${failed} member/inventory checks and ${pagingFailed} paging requests`,
    );
  return { skipped: false, changed, failed };
}

export const reconcileEntitlementsSchedule = schedules.task({
  id: 'reconcile-entitlements-schedule',
  cron: '*/5 * * * *',
  queue: { name: 'entitlement-reconciliation', concurrencyLimit: 1 },
  maxDuration: 1000 * 60 * 30,
  retry: { maxAttempts: 3, minTimeoutInMs: 10_000, maxTimeoutInMs: 60_000 },
  run: runEntitlementReconciliation,
});
