import { fetchEntitlementSnapshot } from './entitlement-snapshot';

const tenantId = '00000000-0000-0000-0000-000000000001';
const subject = '67dc2bb3-7728-4dc5-b945-074aa1c118ef';
const config = {
  readerUrl: 'https://identity.example.com',
  readerToken: 'reader-secret',
  clientId: 'opencomp',
  pagerDutyKey: 'page-key',
  tenantIds: [tenantId],
};
const fetchMock = jest.fn();
const originalFetch = global.fetch;
const snapshot = () => ({
  tenant_id: tenantId,
  user_id: subject,
  client_id: 'opencomp',
  channel: 'oidc',
  complete: true,
  observed_at: new Date().toISOString(),
  user_status: 'active',
  entitlements: ['admin', 'owner'],
});

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock;
});
afterAll(() => {
  global.fetch = originalFetch;
});

it('uses only the scoped reader token and refuses redirects or cached responses', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(snapshot())));
  await expect(
    fetchEntitlementSnapshot({ config, tenantId, subject }),
  ).resolves.toMatchObject({ entitlements: ['admin', 'owner'] });
  const [url, options] = fetchMock.mock.calls[0];
  expect(String(url)).toContain(
    `/tenants/${tenantId}/oidc-entitlements/${subject}?client_id=opencomp`,
  );
  expect(options).toMatchObject({
    headers: { 'x-entitlements-read-token': 'reader-secret' },
    redirect: 'error',
    cache: 'no-store',
  });
});

it.each([401, 403, 404, 429, 500])(
  'does not interpret HTTP %s as revocation',
  async (status) => {
    fetchMock.mockResolvedValue(new Response('{}', { status }));
    await expect(
      fetchEntitlementSnapshot({ config, tenantId, subject }),
    ).rejects.toThrow('IdP entitlement reader failed');
  },
);

it.each([
  { complete: false },
  { entitlements: undefined },
  { entitlements: [12] },
  { tenant_id: '00000000-0000-0000-0000-000000000002' },
  { user_id: '00000000-0000-0000-0000-000000000003' },
  { client_id: 'another-app' },
  { channel: 'scim' },
  { observed_at: new Date(0).toISOString() },
  { observed_at: new Date(Date.now() + 120_000).toISOString() },
  { user_status: 'suspended', entitlements: ['admin'] },
])(
  'rejects incomplete, mismatched or stale snapshots: %j',
  async (override) => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ...snapshot(), ...override })),
    );
    await expect(
      fetchEntitlementSnapshot({ config, tenantId, subject }),
    ).rejects.toThrow();
  },
);

it.each(['active', 'suspended', 'deprovisioned', 'deleted'])(
  'accepts an explicit complete empty result for %s',
  async (user_status) => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ ...snapshot(), user_status, entitlements: [] }),
      ),
    );
    await expect(
      fetchEntitlementSnapshot({ config, tenantId, subject }),
    ).resolves.toMatchObject({ entitlements: [] });
  },
);

it('propagates network failures without inventing empty assignments', async () => {
  fetchMock.mockRejectedValue(new Error('connection failed'));
  await expect(
    fetchEntitlementSnapshot({ config, tenantId, subject }),
  ).rejects.toThrow('connection failed');
});
