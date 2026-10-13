/** PagerDuty Events API v2: configure a service with an on-call escalation. */
export async function reportReconciliationIncident({
  tenantId,
  readerHost,
  failures,
  resolved,
  routingKey,
}: {
  tenantId: string;
  readerHost: string;
  failures: number;
  resolved: boolean;
  routingKey: string;
}): Promise<void> {
  if (!routingKey.trim())
    throw new Error('Reconciliation paging is not configured');
  const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
    body: JSON.stringify({
      routing_key: routingKey,
      dedup_key: `opencomp-entitlements:${readerHost}:${tenantId}`,
      event_action: resolved ? 'resolve' : 'trigger',
      ...(!resolved
        ? {
            payload: {
              summary:
                'OpenComp IdP entitlement reconciliation failed; last-known access retained',
              source: 'opencomp-entitlement-reconciliation',
              severity: 'critical',
              custom_details: { tenantId, failures },
            },
          }
        : {}),
    }),
  });
  if (!response.ok)
    throw new Error(`Reconciliation paging failed (HTTP ${response.status})`);
}
