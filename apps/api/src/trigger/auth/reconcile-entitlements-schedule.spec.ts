import { runEntitlementReconciliation } from './reconcile-entitlements-schedule';
const mockInventory = jest.fn();
const mockReconcile = jest.fn();
const mockPage = jest.fn();
const mockConfig = jest.fn();
const mockEnabled = jest.fn();
jest.mock('@db', () => ({
  serviceDb: {
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
  mockPage.mockResolvedValue(undefined);
  mockReconcile.mockResolvedValue('changed');
  mockInventory
    .mockResolvedValueOnce([{ id: 'mem_revoked' }, { id: 'mem_offboarded' }])
    .mockResolvedValue([]);
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

it('does not mutate any memberships on configuration failure and pages if configured', async () => {
  const old = process.env.GIDEON_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY;
  process.env.GIDEON_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY = 'config-page-key';
  mockConfig.mockImplementationOnce(() => {
    throw new Error('bad configuration');
  });
  try {
    await expect(runEntitlementReconciliation()).rejects.toThrow(
      'configuration is invalid',
    );
    expect(mockInventory).not.toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockPage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'configuration', resolved: false }),
    );
  } finally {
    if (old === undefined)
      delete process.env.GIDEON_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY;
    else process.env.GIDEON_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY = old;
  }
});

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
