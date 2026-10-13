import { ForbiddenException } from '@nestjs/common';
import { provisionGideonUser } from './gideon-oidc-provisioning';
import { getHrSyncUser } from '../integration-platform/services/hr-sync-idp';
import { findLegacySharedUser } from './legacy-shared-user';

const mockFindSubject = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@db', () => ({
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
  db: {
    user: {
      findUnique: (...args: unknown[]) => mockFindSubject(...args),
      findFirst: async () => null,
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    $queryRaw: async () => [],
  },
}));
jest.mock('./legacy-shared-user', () => ({ findLegacySharedUser: jest.fn() }));
const shared = {
  id: 'usr_shared',
  tenantId: 'primary',
  gideonSub: 'sub_primary',
  email: 'shared@example.com',
  banned: false,
};
const lookup = jest.mocked(findLegacySharedUser);
const identity = {
  id: 'sub_secondary',
  email: shared.email,
  display_name: 'Shared',
};

beforeEach(() => {
  jest.resetAllMocks();
  lookup.mockResolvedValue(undefined);
});
describe('shared identity during the expand window', () => {
  it('permits an existing secondary membership with the canonical subject without changing the shared row', async () => {
    mockFindSubject.mockResolvedValue(shared);
    lookup.mockResolvedValue(
      shared as Awaited<ReturnType<typeof findLegacySharedUser>>,
    );
    const beforeWrite = jest.fn();
    await expect(
      provisionGideonUser({
        sub: shared.gideonSub,
        email: shared.email,
        tenantId: 'secondary',
        beforeWrite,
      }),
    ).resolves.toEqual(shared);
    expect(beforeWrite).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it('rejects a distinct secondary subject before it can inherit the primary user memberships', async () => {
    mockFindSubject.mockResolvedValue(null);
    mockCreate.mockRejectedValue({ code: 'P2002' });
    lookup.mockResolvedValue(
      shared as Awaited<ReturnType<typeof findLegacySharedUser>>,
    );
    const beforeWrite = jest.fn();
    await expect(
      provisionGideonUser({
        sub: identity.id,
        email: shared.email,
        tenantId: 'secondary',
        beforeWrite,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(beforeWrite).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it('refuses an unapproved login even when the shared membership exists', async () => {
    mockFindSubject.mockResolvedValue(shared);
    lookup.mockResolvedValue(
      shared as Awaited<ReturnType<typeof findLegacySharedUser>>,
    );
    await expect(
      provisionGideonUser({
        sub: shared.gideonSub,
        email: shared.email,
        tenantId: 'secondary',
        beforeWrite: async () => {
          throw new ForbiddenException();
        },
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it('rejects the other tenant once the compatibility guard no longer returns a shared user', async () => {
    mockFindSubject.mockResolvedValue(shared);
    await expect(
      provisionGideonUser({
        sub: shared.gideonSub,
        email: shared.email,
        tenantId: 'secondary',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
  it('allows HR sync to use an existing shared membership without changing its primary subject', async () => {
    mockFindSubject.mockResolvedValue(shared);
    lookup.mockResolvedValue(
      shared as Awaited<ReturnType<typeof findLegacySharedUser>>,
    );
    await expect(
      getHrSyncUser({
        identity: { ...identity, id: shared.gideonSub },
        organizationId: 'secondary',
      }),
    ).resolves.toEqual(shared);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
  it('allows HR sync with a distinct secondary subject after the global email conflict', async () => {
    mockFindSubject.mockResolvedValue(null);
    mockCreate.mockRejectedValue(
      Object.assign(new Error('conflict'), { code: 'P2002' }),
    );
    lookup.mockResolvedValue(
      shared as Awaited<ReturnType<typeof findLegacySharedUser>>,
    );
    await expect(
      getHrSyncUser({ identity, organizationId: 'secondary' }),
    ).resolves.toEqual(shared);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
