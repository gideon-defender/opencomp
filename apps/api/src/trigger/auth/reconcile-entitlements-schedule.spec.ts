import { runEntitlementReconciliation } from './reconcile-entitlements-schedule';
const mockInventory = jest.fn();
const mockTenants = jest.fn();
const mockReconcile = jest.fn();
const mockPage = jest.fn();
const mockConfig = jest.fn();
const mockEnabled = jest.fn();
jest.mock('@db', () => ({
  serviceDb: {
    organization: { findMany: (...args: unknown[]) => mockTenants(...args) },
    member: { findMany: (...args: unknown[]) => mockInventory(...args) },
  },
}));
jest.mock('../../auth/reconcile-sso-member', () => ({
  reconcileSsoMember: (...args: unknown[]) => mockReconcile(...args),
}));
jest.mock('../../auth/entitlement-reconciliation-config', () => ({
  readReconciliationConfig: () => mockConfig(),
  reconciliationEnabled: () => mockEnabled(),
}));
jest.mock('./entitlement-reconciliation-alert', () => ({
  reportReconciliationIncident: (...args: unknown[]) => mockPage(...args),
}));
jest.mock('@gideon-defender/trigger-local', () => ({
  logger: { info: jest.fn(), error: jest.fn() },
  schedules: { task: (definition: unknown) => definition },
}));

const config = {
  readerUrl: 'https://identity.example.com',
  readerToken: 'read-key',
  clientId: 'opencomp',
  pagerDutyKey: 'page-key',
  tenantIds: ['tenant_1'],
};
beforeEach(() => {
  jest.resetAllMocks();
  mockEnabled.mockReturnValue(true);
  mockConfig.mockReturnValue(config);
  mockTenants.mockResolvedValue([]);
  mockPage.mockResolvedValue(undefined);
  mockReconcile.mockResolvedValue('changed');
  mockInventory
    .mockResolvedValueOnce([{ id: 'mem_revoked' }, { id: 'mem_offboarded' }])
    .mockResolvedValue([]);
});

it('discovers tenants beyond the pilot allowlist on every all-tenant run', async () => {
  mockConfig.mockReturnValue({ ...config, allTenants: true });
  mockTenants
    .mockResolvedValueOnce([{ id: 'tenant_1' }])
    .mockResolvedValueOnce([{ id: 'tenant_new' }])
    .mockResolvedValue([]);
  mockInventory
    .mockReset()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: 'mem_new' }])
    .mockResolvedValue([]);
  await expect(runEntitlementReconciliation()).resolves.toMatchObject({
    changed: 1,
  });
  expect(mockTenants).toHaveBeenNthCalledWith(2, {
    where: { id: { gt: 'tenant_1' } },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 100,
  });
  expect(mockReconcile).toHaveBeenCalledWith({
    memberId: 'mem_new',
    tenantId: 'tenant_new',
    config: expect.objectContaining({ tenantIds: ['tenant_1', 'tenant_new'] }),
  });
});

it('fails before membership changes if all-tenant discovery fails', async () => {
  mockConfig.mockReturnValue({ ...config, allTenants: true });
  mockTenants.mockRejectedValue(new Error('inventory unavailable'));
  await expect(runEntitlementReconciliation()).rejects.toThrow();
  expect(mockInventory).not.toHaveBeenCalled();
  expect(mockReconcile).not.toHaveBeenCalled();
});

it('does nothing when disabled', async () => {
  mockEnabled.mockReturnValue(false);
  await expect(runEntitlementReconciliation()).resolves.toMatchObject({
    skipped: true,
  });
  expect(mockInventory).not.toHaveBeenCalled();
  expect(mockPage).not.toHaveBeenCalled();
});

it('includes already revoked and HR-offboarded SSO members in paginated, tenant-scoped inventory', async () => {
  await expect(runEntitlementReconciliation()).resolves.toMatchObject({
    changed: 2,
    failed: 0,
  });
  expect(mockInventory.mock.calls[0][0].where).toEqual({
    organizationId: 'tenant_1',
    roleSource: 'sso',
  });
  expect(mockInventory.mock.calls[1][0].where).toEqual({
    organizationId: 'tenant_1',
    roleSource: 'sso',
    id: { gt: 'mem_offboarded' },
  });
  expect(mockReconcile).toHaveBeenCalledWith({
    memberId: 'mem_revoked',
    tenantId: 'tenant_1',
    config,
  });
  expect(mockPage).toHaveBeenCalledWith(
    expect.objectContaining({ resolved: true }),
  );
});

it('pages on the first failure, keeps processing other members and fails the run', async () => {
  mockReconcile
    .mockRejectedValueOnce(new Error('IdP unavailable'))
    .mockResolvedValue('unchanged');
  await expect(runEntitlementReconciliation()).rejects.toThrow('failed for 1');
  expect(mockReconcile).toHaveBeenCalledTimes(2);
  expect(mockPage.mock.invocationCallOrder[0]).toBeLessThan(
    mockReconcile.mock.invocationCallOrder[1],
  );
  expect(mockPage).not.toHaveBeenCalledWith(
    expect.objectContaining({ resolved: true }),
  );
});

it('pages on inventory failure rather than treating it as an empty tenant', async () => {
  mockInventory
    .mockReset()
    .mockRejectedValue(new Error('database unavailable'));
  await expect(runEntitlementReconciliation()).rejects.toThrow('failed for 1');
  expect(mockPage).toHaveBeenCalledWith(
    expect.objectContaining({ resolved: false, failures: 1 }),
  );
});

describe.each(['configuration', 'tenant discovery'])(
  '%s failure',
  (failure) => {
    it.each([
      {
        primary: 'oidc-page-key',
        legacy: undefined,
        expected: 'oidc-page-key',
      },
      {
        primary: undefined,
        legacy: 'legacy-page-key',
        expected: 'legacy-page-key',
      },
      {
        primary: 'oidc-page-key',
        legacy: 'legacy-page-key',
        expected: 'oidc-page-key',
      },
    ])(
      'pages with $expected before any membership changes',
      async ({ primary, legacy, expected }) => {
        const oldEnv = process.env;
        process.env = { ...oldEnv };
        delete process.env.OIDC_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY;
        delete process.env.GIDEON_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY;
        if (primary)
          process.env.OIDC_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY = primary;
        if (legacy)
          process.env.GIDEON_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY = legacy;
        if (failure === 'configuration') {
          mockConfig.mockImplementationOnce(() => {
            throw new Error('bad configuration');
          });
        } else {
          mockConfig.mockReturnValue({ ...config, allTenants: true });
          mockTenants.mockRejectedValue(new Error('inventory unavailable'));
        }
        try {
          await expect(runEntitlementReconciliation()).rejects.toThrow(
            'configuration is invalid',
          );
          expect(mockInventory).not.toHaveBeenCalled();
          expect(mockReconcile).not.toHaveBeenCalled();
          expect(mockPage).toHaveBeenCalledTimes(1);
          expect(mockPage).toHaveBeenCalledWith({
            tenantId: 'configuration',
            readerHost: 'configuration',
            failures: 1,
            resolved: false,
            routingKey: expected,
          });
        } finally {
          process.env = oldEnv;
        }
      },
    );
  },
);

it.each([false, true])(
  'continues all members and tenants when alert delivery fails (member failure=%s)',
  async (memberFailure) => {
    mockConfig.mockReturnValue({
      ...config,
      tenantIds: ['tenant_1', 'tenant_2'],
    });
    mockInventory
      .mockReset()
      .mockResolvedValueOnce([{ id: 'mem_1' }, { id: 'mem_2' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'mem_3' }])
      .mockResolvedValueOnce([]);
    if (memberFailure)
      mockReconcile.mockRejectedValueOnce(new Error('reader down'));
    mockPage.mockRejectedValue(new Error('PagerDuty unavailable'));

    await expect(runEntitlementReconciliation()).rejects.toThrow('paging');
    expect(mockReconcile).toHaveBeenCalledTimes(3);
    expect(mockReconcile).toHaveBeenLastCalledWith({
      memberId: 'mem_3',
      tenantId: 'tenant_2',
      config: expect.any(Object),
    });
    expect(mockInventory).toHaveBeenCalledTimes(4);
    expect(mockPage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant_2' }),
    );
  },
);
