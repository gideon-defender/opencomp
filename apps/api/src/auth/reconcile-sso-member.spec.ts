jest.mock('./legacy-shared-user', () => ({
  findLegacySharedUser: jest.fn().mockResolvedValue(undefined),
}));

import { reconcileSsoMember } from './reconcile-sso-member';
import { NativeSessionService } from './native-session.service';
import { HybridSessionAuth } from './hybrid-session-auth';

const mockTransaction = jest.fn();
const mockFindMember = jest.fn();
const mockFindSession = jest.fn();
const mockSnapshot = jest.fn();
jest.mock('@db', () => ({
  normalizeEmail: (value: string) => value.trim().toLowerCase(),
  serviceDb: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
  db: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    member: { findFirst: (...args: unknown[]) => mockFindMember(...args) },
    session: { findUnique: (...args: unknown[]) => mockFindSession(...args) },
  },
}));
jest.mock('@gideon-defender/auth', () => ({
  BUILT_IN_ROLE_PERMISSIONS: { owner: {}, admin: {}, auditor: {} },
}));
jest.mock('./entitlement-snapshot', () => ({
  fetchEntitlementSnapshot: (...args: unknown[]) => mockSnapshot(...args),
}));
jest.mock('./auth.server', () => ({
  auth: { api: { getMcpSession: jest.fn().mockResolvedValue(null) } },
}));
jest.mock('./legacy-session-revocation', () => ({
  LegacySessionRevocation: class {
    rejectsSession() {
      return false;
    }
  },
}));

const tenantId = '00000000-0000-0000-0000-000000000001';
const config = {
  readerUrl: 'https://identity.example.com',
  readerToken: 'secret',
  clientId: 'opencomp',
  pagerDutyKey: 'key',
  tenantIds: [tenantId],
};
const initialMember = () => ({
  id: 'mem_1',
  userId: 'usr_1',
  organizationId: tenantId,
  role: 'admin,owner',
  roleSource: 'sso',
  idpAccessRevoked: false,
  deactivated: false,
  isActive: true,
  department: 'engineering',
  onboardDate: new Date('2020-01-01'),
  offboardDate: null,
  user: {
    oidcSub: '67dc2bb3-7728-4dc5-b945-074aa1c118ef',
    tenantId,
    email: 'shared@example.com',
  },
});
let member = initialMember();
let sessions = [
  { token: 'retained-session', activeOrganizationId: tenantId },
  { token: 'other-tenant-session', activeOrganizationId: 'other-tenant' },
];
const tx = {
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn(),
  member: { findFirst: jest.fn(), update: jest.fn() },
  organizationRole: { findMany: jest.fn() },
  session: { deleteMany: jest.fn() },
  auditLog: { create: jest.fn() },
  user: { update: jest.fn() },
};

beforeEach(() => {
  jest.clearAllMocks();
  member = initialMember();
  sessions = [
    { token: 'retained-session', activeOrganizationId: tenantId },
    { token: 'other-tenant-session', activeOrganizationId: 'other-tenant' },
  ];
  tx.member.findFirst.mockImplementation(() =>
    member.roleSource === 'sso' ? structuredClone(member) : null,
  );
  tx.organizationRole.findMany.mockResolvedValue([{ name: 'custom-reviewer' }]);
  tx.member.update.mockImplementation(
    ({ data }: { data: { role: string; idpAccessRevoked: boolean } }) => {
      Object.assign(member, data);
      return Promise.resolve(member);
    },
  );
  tx.session.deleteMany.mockImplementation(
    ({
      where,
    }: {
      where: { userId: string; activeOrganizationId: string };
    }) => {
      const count = sessions.filter(
        (session) =>
          session.activeOrganizationId === where.activeOrganizationId,
      ).length;
      sessions = sessions.filter(
        (session) =>
          session.activeOrganizationId !== where.activeOrganizationId,
      );
      return Promise.resolve({ count });
    },
  );
  tx.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  mockTransaction.mockImplementation(
    async (work: (value: typeof tx) => Promise<unknown>) => {
      const before = structuredClone(member);
      const beforeSessions = structuredClone(sessions);
      try {
        return await work(tx);
      } catch (error) {
        member = before;
        sessions = beforeSessions;
        throw error;
      }
    },
  );
  mockSnapshot.mockResolvedValue({
    entitlements: ['owner', 'admin'],
    user_status: 'active',
    observed_at: new Date().toISOString(),
  });
  mockFindMember.mockImplementation(
    ({
      where,
    }: {
      where: { deactivated: boolean; idpAccessRevoked: boolean };
    }) =>
      member.deactivated === where.deactivated &&
      member.idpAccessRevoked === where.idpAccessRevoked
        ? member
        : null,
  );
  mockFindSession.mockImplementation(
    ({ where }: { where: { token: string } }) =>
      sessions.some((session) => session.token === where.token)
        ? {
            id: 'ses_1',
            activeOrganizationId: tenantId,
            expiresAt: new Date(Date.now() + 60_000),
            deviceAgent: false,
            user: { id: 'usr_1', email: 'test@example.com' },
          }
        : null,
  );
});

function reconcile() {
  return reconcileSsoMember({ memberId: 'mem_1', tenantId, config });
}
function request(token = 'retained-session') {
  const result = Object.assign(new Request('https://opencomp.example.com'), {
    organizationId: tenantId,
    authType: 'session' as const,
    isApiKey: false,
    userRoles: null,
  });
  Object.defineProperty(result, 'headers', {
    value: Object.assign(new Headers(), { authorization: `Bearer ${token}` }),
  });
  return result;
}
function sessionGuard() {
  return new HybridSessionAuth({
    nativeSessionService: new NativeSessionService(),
  });
}

it('leaves existing owner/admin access and its sessions intact on an unchanged snapshot', async () => {
  await expect(reconcile()).resolves.toBe('unchanged');
  expect(tx.member.update).not.toHaveBeenCalled();
  expect(tx.session.deleteMany).not.toHaveBeenCalled();
  await expect(sessionGuard().handleSessionAuth(request())).resolves.toBe(true);
});

it.each([
  { entitlements: [] },
  { entitlements: ['foreign-role'] },
  { entitlements: ['owner\n'] },
])(
  'revokes retained sessions for empty or invalid entitlements',
  async ({ entitlements }) => {
    await expect(sessionGuard().handleSessionAuth(request())).resolves.toBe(
      true,
    );
    mockSnapshot.mockResolvedValue({ entitlements, user_status: 'active' });
    await expect(reconcile()).resolves.toBe('changed');
    expect(member.role).toBe('');
    expect(member.idpAccessRevoked).toBe(true);
    await expect(sessionGuard().handleSessionAuth(request())).rejects.toThrow();
    expect(sessions).toEqual([
      { token: 'other-tenant-session', activeOrganizationId: 'other-tenant' },
    ]);
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: tenantId,
          data: expect.objectContaining({
            previous: { role: 'admin,owner', idpAccessRevoked: false },
            current: { role: '', idpAccessRevoked: true },
          }),
        }),
      }),
    );
  },
);

it.each([false, true])(
  'restores only IdP access and preserves HR deactivation=%s',
  async (deactivated) => {
    member.role = '';
    member.idpAccessRevoked = true;
    member.deactivated = deactivated;
    member.isActive = !deactivated;
    const hrBefore = {
      deactivated: member.deactivated,
      isActive: member.isActive,
      department: member.department,
      onboardDate: member.onboardDate,
      offboardDate: member.offboardDate,
    };
    mockSnapshot.mockResolvedValue({
      entitlements: ['auditor'],
      user_status: 'active',
    });
    await reconcile();
    expect(member).toMatchObject({
      ...hrBefore,
      role: 'auditor',
      idpAccessRevoked: false,
    });
    expect(tx.member.update).toHaveBeenCalledWith({
      where: { id: 'mem_1' },
      data: { role: 'auditor', idpAccessRevoked: false },
    });
    if (deactivated)
      await expect(
        sessionGuard().handleSessionAuth(request()),
      ).rejects.toThrow();
    else
      await expect(sessionGuard().handleSessionAuth(request())).resolves.toBe(
        true,
      );
  },
);

it('overwrites and intersects tenant-valid roles instead of unioning old roles', async () => {
  mockSnapshot.mockResolvedValue({
    entitlements: ['auditor', 'custom-reviewer', 'foreign-role', 'auditor'],
    user_status: 'active',
  });
  await reconcile();
  expect(member.role).toBe('auditor,custom-reviewer');
  expect(member.idpAccessRevoked).toBe(false);
});

it('preserves last-known state and sessions on IdP failure', async () => {
  mockSnapshot.mockRejectedValue(new Error('IdP unavailable'));
  await expect(reconcile()).rejects.toThrow('IdP unavailable');
  expect(member).toEqual(initialMember());
  expect(sessions).toHaveLength(2);
  expect(tx.member.update).not.toHaveBeenCalled();
  expect(tx.auditLog.create).not.toHaveBeenCalled();
});

it('rolls back membership and session deletion if the audit cannot commit', async () => {
  mockSnapshot.mockResolvedValue({ entitlements: [], user_status: 'active' });
  tx.auditLog.create.mockRejectedValueOnce(new Error('audit unavailable'));
  await expect(reconcile()).rejects.toThrow('audit unavailable');
  expect(member).toEqual(initialMember());
  expect(sessions).toHaveLength(2);
});

it('skips a membership changed to local ownership while the inventory was being read', async () => {
  member.roleSource = 'local';
  await expect(reconcile()).resolves.toBe('skipped');
  expect(mockSnapshot).not.toHaveBeenCalled();
});

it('rejects a foreign subject link and non-enabled tenant without changing access', async () => {
  member.user.tenantId = 'foreign-tenant';
  await expect(reconcile()).rejects.toThrow('tenant-linked');
  expect(mockSnapshot).not.toHaveBeenCalled();
  await expect(
    reconcileSsoMember({ memberId: 'mem_1', tenantId: 'other-tenant', config }),
  ).rejects.toThrow('not enabled');
});
