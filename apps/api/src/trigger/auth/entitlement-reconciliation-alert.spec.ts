import { reportReconciliationIncident } from './entitlement-reconciliation-alert';
const originalFetch = global.fetch;
const fetchMock = jest.fn();
jest.mock('@gideon-defender/trigger-local', () => ({
  logger: { error: jest.fn() },
}));
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock;
});
afterAll(() => {
  global.fetch = originalFetch;
});
const parameters = {
  tenantId: 'tenant_1',
  readerHost: 'dev.example.com',
  failures: 1,
  resolved: false,
  routingKey: 'secret-routing-key',
};

it('makes no PagerDuty request when validated dev configuration skips paging', async () => {
  await reportReconciliationIncident({ ...parameters, routingKey: undefined });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('triggers a deduplicated critical incident with no user identity or credentials in the summary', async () => {
  fetchMock.mockResolvedValue(new Response('{}', { status: 202 }));
  await reportReconciliationIncident(parameters);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe('https://events.pagerduty.com/v2/enqueue');
  expect(options.redirect).toBe('error');
  const body: unknown = JSON.parse(options.body);
  expect(body).toMatchObject({
    event_action: 'trigger',
    dedup_key: 'opencomp-entitlements:dev.example.com:tenant_1',
    payload: {
      severity: 'critical',
      custom_details: { tenantId: 'tenant_1', failures: 1 },
    },
  });
});

it('resolves the same incident after recovery', async () => {
  fetchMock.mockResolvedValue(new Response('{}', { status: 202 }));
  await reportReconciliationIncident({
    ...parameters,
    failures: 0,
    resolved: true,
  });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
    event_action: 'resolve',
    dedup_key: 'opencomp-entitlements:dev.example.com:tenant_1',
  });
});

it('reports paging failure rather than claiming that an incident was delivered', async () => {
  fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
  await expect(reportReconciliationIncident(parameters)).rejects.toThrow(
    'paging failed',
  );
  await expect(
    reportReconciliationIncident({ ...parameters, routingKey: '' }),
  ).rejects.toThrow('not configured');
});
