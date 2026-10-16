import { reconcileSsoMember } from './reconcile-sso-member';
import { lookupGideonTenantIdentity } from './gideon-tenant-identity';
import { findLegacySharedUser } from './legacy-shared-user';
import { fetchEntitlementSnapshot } from './entitlement-snapshot';

jest.mock('./gideon-tenant-identity', () => ({
  lookupGideonTenantIdentity: jest.fn(),
}));
jest.mock('./legacy-shared-user', () => ({ findLegacySharedUser: jest.fn() }));
jest.mock('./entitlement-snapshot', () => ({
  fetchEntitlementSnapshot: jest.fn(),
}));
jest.mock('@db', () => ({
  normalizeEmail: (value: string) => value.trim().toLowerCase(),
  serviceDb: { $transaction: (work: (tx: unknown) => unknown) => work(tx) },
}));

const member = {
  id: 'member',
  userId: 'shared',
  role: 'admin',
  idpAccessRevoked: false,
  user: {
    oidcSub: 'primary-sub',
    tenantId: 'primary',
    email: 'shared@example.com',
  },
};
const tx = {
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn(),
  member: { findFirst: jest.fn(), update: jest.fn() },
  user: { update: jest.fn() },
  organizationRole: { findMany: jest.fn() },
  session: { deleteMany: jest.fn() },
  auditLog: { create: jest.fn() },
};
const config = {
  tenantIds: ['secondary'],
  readerUrl: 'https://identity.example.com',
  readerToken: 'token',
  clientId: 'opencomp',
};
const reconcile = () =>
  reconcileSsoMember({ memberId: member.id, tenantId: 'secondary', config });

beforeEach(() => {
  jest.resetAllMocks();
  tx.member.findFirst.mockResolvedValue(member);
  tx.organizationRole.findMany.mockResolvedValue([]);
  tx.session.deleteMany.mockResolvedValue({ count: 1 });
  jest.mocked(findLegacySharedUser).mockResolvedValue({
    ...member.user,
    id: member.userId,
    name: 'Shared',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLogin: null,
    emailNotificationsUnsubscribed: false,
    emailPreferences: null,
    banned: false,
    banReason: null,
    banExpires: null,
    oidcTenantId: 'primary',
  });
  jest.mocked(lookupGideonTenantIdentity).mockResolvedValue({
    id: 'secondary-sub',
    email: member.user.email,
    display_name: null,
    status: 'active',
  });
  jest.mocked(fetchEntitlementSnapshot).mockResolvedValue({
    tenant_id: 'secondary',
    user_id: 'secondary-sub',
    client_id: 'opencomp',
    complete: true,
    channel: 'oidc',
    entitlements: [],
    observed_at: new Date().toISOString(),
    user_status: 'active',
  });
});

it('revokes a secondary grant and its sessions using the tenant-specific subject', async () => {
  expect(await reconcile()).toBe('changed');
  expect(fetchEntitlementSnapshot).toHaveBeenCalledWith({
    config,
    tenantId: 'secondary',
    subject: 'secondary-sub',
  });
  expect(tx.member.update).toHaveBeenCalledWith({
    where: { id: member.id },
    data: { role: '', idpAccessRevoked: true },
  });
  expect(tx.session.deleteMany).toHaveBeenCalledWith({
    where: { userId: 'shared', activeOrganizationId: 'secondary' },
  });
});

it('revokes a secondary identity that the complete tenant lookup no longer finds', async () => {
  jest.mocked(lookupGideonTenantIdentity).mockResolvedValue(null);
  expect(await reconcile()).toBe('changed');
  expect(fetchEntitlementSnapshot).not.toHaveBeenCalled();
  expect(tx.member.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { role: '', idpAccessRevoked: true } }),
  );
});

it('preserves access on identity reader failure and rejects an unrelated foreign row', async () => {
  jest
    .mocked(lookupGideonTenantIdentity)
    .mockRejectedValue(new Error('Unavailable'));
  await expect(reconcile()).rejects.toThrow('Unavailable');
  expect(tx.member.update).not.toHaveBeenCalled();
  expect(tx.session.deleteMany).not.toHaveBeenCalled();
  jest.mocked(findLegacySharedUser).mockResolvedValue(undefined);
  await expect(reconcile()).rejects.toThrow('tenant-linked');
});

it('claims a null-tenant row before fetching its existing subject', async () => {
  tx.member.findFirst.mockResolvedValue({
    ...member,
    user: { ...member.user, tenantId: null },
  });
  jest.mocked(fetchEntitlementSnapshot).mockResolvedValue({
    tenant_id: 'secondary',
    user_id: 'primary-sub',
    client_id: 'opencomp',
    complete: true,
    channel: 'oidc',
    entitlements: ['admin'],
    observed_at: new Date().toISOString(),
    user_status: 'active',
  });
  expect(await reconcile()).toBe('unchanged');
  expect(tx.user.update).toHaveBeenCalledWith({
    where: { id: member.userId },
    data: { tenantId: 'secondary' },
  });
  expect(lookupGideonTenantIdentity).not.toHaveBeenCalled();
});

it('retains a descriptive ownership collision error', async () => {
  tx.member.findFirst.mockResolvedValue({
    ...member,
    user: { ...member.user, tenantId: null },
  });
  tx.user.update.mockRejectedValue({ code: 'P2002' });
  await expect(reconcile()).rejects.toThrow('conflicts within tenant');
  expect(fetchEntitlementSnapshot).not.toHaveBeenCalled();
});
