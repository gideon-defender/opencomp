import { reconcileSsoMember } from './reconcile-sso-member';
import { syncSsoMember } from './sso-member-sync';

const mockTransaction = jest.fn();
const mockSnapshot = jest.fn();
const mockEnabled = jest.fn();
const mockConfig = jest.fn();
const mockFindRacedMember = jest.fn();
const tenantId = '00000000-0000-0000-0000-000000000001';
const config = {
  readerUrl: 'https://identity.example.com',
  readerToken: 'reader-key',
  clientId: 'opencomp',
  pagerDutyKey: 'page-key',
  tenantIds: [tenantId],
};
jest.mock('@db', () => ({
  normalizeEmail: jest.requireActual('@gideon-defender/email').normalizeEmail,
  db: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    member: { findFirst: (...args: unknown[]) => mockFindRacedMember(...args) },
  },
  serviceDb: { $transaction: (...args: unknown[]) => mockTransaction(...args) },
}));
jest.mock('./entitlement-snapshot', () => ({
  fetchEntitlementSnapshot: (...args: unknown[]) => mockSnapshot(...args),
}));
jest.mock('./entitlement-reconciliation-config', () => ({
  reconciliationEnabled: () => mockEnabled(),
  readReconciliationConfig: () => mockConfig(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const initialMember = () => ({
  id: 'mem_1',
  userId: 'usr_1',
  organizationId: tenantId,
  role: 'admin',
  roleSource: 'sso',
  idpAccessRevoked: false,
  user: {
    oidcSub: '67dc2bb3-7728-4dc5-b945-074aa1c118ef',
    tenantId,
    email: 'user@example.com',
  },
});
let member = initialMember();
let pendingLock: Promise<void> = Promise.resolve();
const tx = {
  $executeRaw: jest.fn(),
  member: {
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  user: { findUnique: jest.fn() },
  organizationRole: { findMany: jest.fn() },
  session: { deleteMany: jest.fn() },
  auditLog: { create: jest.fn() },
};

beforeEach(() => {
  jest.resetAllMocks();
  member = initialMember();
  pendingLock = Promise.resolve();
  mockEnabled.mockReturnValue(true);
  mockConfig.mockReturnValue(config);
  tx.member.findFirst.mockImplementation(async () => structuredClone(member));
  tx.member.update.mockImplementation(
    async ({
      data,
    }: {
      data: { role: string; roleSource?: string; idpAccessRevoked: boolean };
    }) => Object.assign(member, data),
  );
  tx.user.findUnique.mockImplementation(async () => member.user);
  tx.organizationRole.findMany.mockResolvedValue([]);
  tx.session.deleteMany.mockResolvedValue({ count: 1 });
  tx.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  mockTransaction.mockImplementation(
    async (
      work: (
        value: typeof tx & {
          $queryRaw: () => Promise<void>;
        },
      ) => Promise<unknown>,
    ) => {
      let unlock: (() => void) | undefined;
      try {
        return await work({
          ...tx,
          $queryRaw: async () => {
            const previous = pendingLock;
            const held = deferred<void>();
            pendingLock = held.promise;
            unlock = () => held.resolve();
            await previous;
          },
        });
      } finally {
        unlock?.();
      }
    },
  );
});

it('refreshes owner/admin at login when all-tenant mode has no static tenant list', async () => {
  mockConfig.mockReturnValue({ ...config, allTenants: true, tenantIds: [] });
  mockSnapshot.mockResolvedValue({ entitlements: ['owner', 'admin'] });
  await syncSsoMember({
    userId: member.userId,
    organizationId: tenantId,
    roles: ['admin', 'owner'],
  });
  expect(member).toMatchObject({
    role: 'admin,owner',
    roleSource: 'sso',
    idpAccessRevoked: false,
  });
  expect(mockSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({ tenantId }),
  );
});

it('still denies login when an all-tenant reader snapshot has no entitlements', async () => {
  mockConfig.mockReturnValue({ ...config, allTenants: true, tenantIds: [] });
  mockSnapshot.mockResolvedValue({ entitlements: [] });
  await expect(
    syncSsoMember({
      userId: member.userId,
      organizationId: tenantId,
      roles: ['owner'],
    }),
  ).rejects.toThrow('no valid IdP role assignment');
  expect(tx.member.update).not.toHaveBeenCalled();
});

it('keeps the tenant allowlist restriction when all-tenant mode is off', async () => {
  mockConfig.mockReturnValue({ ...config, allTenants: false, tenantIds: [] });
  await expect(
    syncSsoMember({
      userId: member.userId,
      organizationId: tenantId,
      roles: ['owner'],
    }),
  ).rejects.toThrow('Tenant is not enabled');
  expect(mockSnapshot).not.toHaveBeenCalled();
  expect(tx.member.update).not.toHaveBeenCalled();
});

it.each([{ entitlements: [] }, { entitlements: ['auditor'] }])(
  'does not restore stale admin claims after a concurrent poll commits %j',
  async ({ entitlements }) => {
    const fetched = deferred<void>();
    const releaseSnapshot = deferred<void>();
    const snapshot = {
      entitlements,
      user_status: 'active',
      observed_at: new Date().toISOString(),
    };
    mockSnapshot
      .mockImplementationOnce(async () => {
        fetched.resolve();
        await releaseSnapshot.promise;
        return snapshot;
      })
      .mockResolvedValue(snapshot);

    const poll = reconcileSsoMember({ memberId: member.id, tenantId, config });
    await fetched.promise;
    const login = syncSsoMember({
      userId: member.userId,
      organizationId: tenantId,
      roles: ['admin'],
    });
    // Attach the rejection handler before releasing the competing transaction.
    const loginResult = login.then(
      () => 'granted',
      () => 'denied',
    );
    releaseSnapshot.resolve();
    await expect(poll).resolves.toBe('changed');
    await expect(loginResult).resolves.toBe(
      entitlements.length ? 'granted' : 'denied',
    );
    expect(member.role).toBe(entitlements.join(','));
    expect(member.idpAccessRevoked).toBe(entitlements.length === 0);
    expect(mockSnapshot).toHaveBeenCalledTimes(2);
  },
);

it('allows a genuine IdP regrant instead of permanently blocking a revoked member', async () => {
  member.role = '';
  member.idpAccessRevoked = true;
  mockSnapshot.mockResolvedValue({ entitlements: ['auditor'] });
  await syncSsoMember({
    userId: member.userId,
    organizationId: tenantId,
    roles: ['admin'],
  });
  expect(member).toMatchObject({ role: 'auditor', idpAccessRevoked: false });
});

it('keeps revocation intact when the fresh reader is unavailable', async () => {
  member.role = '';
  member.idpAccessRevoked = true;
  mockSnapshot.mockRejectedValue(new Error('reader down'));
  await expect(
    syncSsoMember({
      userId: member.userId,
      organizationId: tenantId,
      roles: ['admin'],
    }),
  ).rejects.toThrow('reader down');
  expect(tx.member.update).not.toHaveBeenCalled();
  expect(member).toMatchObject({ role: '', idpAccessRevoked: true });
});

it('refreshes grants again after a concurrent first-login create conflict', async () => {
  tx.member.findFirst.mockResolvedValueOnce(null);
  tx.member.create.mockRejectedValueOnce({ code: 'P2002' });
  mockFindRacedMember.mockResolvedValue({ id: member.id });
  mockSnapshot
    .mockResolvedValueOnce({ entitlements: ['admin'] })
    .mockResolvedValue({ entitlements: [] });

  await expect(
    syncSsoMember({
      userId: member.userId,
      organizationId: tenantId,
      roles: ['admin'],
    }),
  ).rejects.toThrow('no valid IdP role assignment');
  expect(mockTransaction).toHaveBeenCalledTimes(2);
  expect(mockSnapshot).toHaveBeenCalledTimes(2);
  expect(tx.member.update).not.toHaveBeenCalled();
});

it('rejects a foreign subject link before requesting a snapshot', async () => {
  member.user.tenantId = 'foreign-tenant';
  await expect(
    syncSsoMember({
      userId: member.userId,
      organizationId: tenantId,
      roles: ['admin'],
    }),
  ).rejects.toThrow('tenant-linked');
  expect(mockSnapshot).not.toHaveBeenCalled();
  expect(tx.member.update).not.toHaveBeenCalled();
});
