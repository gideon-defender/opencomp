import {
  filterActiveIdpOrganizations,
  requireActiveIdpMembership,
  requireOrganizationRequestAccess,
} from './idp-organization-access-plugin';
const mockMember = jest.fn();
const mockMembers = jest.fn();
const mockOrganization = jest.fn();
jest.mock('@db', () => ({
  db: {
    organization: {
      findUnique: (...args: unknown[]) => mockOrganization(...args),
    },
    member: {
      findFirst: (...args: unknown[]) => mockMember(...args),
      findMany: (...args: unknown[]) => mockMembers(...args),
    },
  },
}));

beforeEach(() => jest.resetAllMocks());

it('allows an active owner/admin membership using current database state', async () => {
  mockMember.mockResolvedValue({ id: 'mem_1' });
  await expect(
    requireActiveIdpMembership({ userId: 'usr_1', organizationId: 'org_1' }),
  ).resolves.toBeUndefined();
  expect(mockMember).toHaveBeenCalledWith({
    where: {
      userId: 'usr_1',
      organizationId: 'org_1',
      deactivated: false,
      idpAccessRevoked: false,
    },
    select: { id: true },
  });
});

it('denies a retained revoked or HR-offboarded row during organization reads/selection', async () => {
  mockMember.mockResolvedValue(null);
  await expect(
    requireActiveIdpMembership({ userId: 'usr_1', organizationId: 'org_1' }),
  ).rejects.toThrow('inactive or revoked');
});

it('filters revoked organizations from selection lists without discarding other valid memberships', async () => {
  mockMembers.mockResolvedValue([{ organizationId: 'org_active' }]);
  await expect(
    filterActiveIdpOrganizations({
      userId: 'usr_1',
      organizations: [
        { id: 'org_revoked', name: 'Revoked' },
        { id: 'org_active', name: 'Active' },
      ],
    }),
  ).resolves.toEqual([{ id: 'org_active', name: 'Active' }]);
  expect(mockMembers).toHaveBeenCalledWith({
    where: { userId: 'usr_1', deactivated: false, idpAccessRevoked: false },
    select: { organizationId: true },
  });
});

it('rejects selecting a revoked organization even from another valid session', async () => {
  mockMember.mockResolvedValue(null);
  await expect(
    requireOrganizationRequestAccess({
      userId: 'usr_1',
      activeOrganizationId: 'org_valid',
      path: '/organization/set-active',
      body: { organizationId: 'org_revoked' },
      query: {},
    }),
  ).rejects.toThrow('inactive or revoked');
  expect(mockMember.mock.calls[0][0].where.organizationId).toBe('org_revoked');
});

it('checks both slug and ID scopes to prevent conflicting-target bypasses', async () => {
  mockOrganization.mockResolvedValue({ id: 'org_revoked' });
  mockMember.mockImplementation(
    ({ where }: { where: { organizationId: string } }) =>
      where.organizationId === 'org_valid' ? { id: 'mem_valid' } : null,
  );
  await expect(
    requireOrganizationRequestAccess({
      userId: 'usr_1',
      activeOrganizationId: 'org_valid',
      path: '/organization/get-full-organization',
      body: {},
      query: { organizationId: 'org_valid', organizationSlug: 'revoked' },
    }),
  ).rejects.toThrow('inactive or revoked');
});

it('can clear a selection and can select a valid org after another membership is revoked', async () => {
  await expect(
    requireOrganizationRequestAccess({
      userId: 'usr_1',
      activeOrganizationId: 'org_revoked',
      path: '/organization/set-active',
      body: { organizationId: null },
      query: {},
    }),
  ).resolves.toBeUndefined();
  expect(mockMember).not.toHaveBeenCalled();
  mockMember.mockResolvedValue({ id: 'mem_valid' });
  await expect(
    requireOrganizationRequestAccess({
      userId: 'usr_1',
      activeOrganizationId: 'org_revoked',
      path: '/organization/set-active',
      body: { organizationId: 'org_valid' },
      query: {},
    }),
  ).resolves.toBeUndefined();
  expect(mockMember).toHaveBeenCalledTimes(1);
});
