import { ForbiddenException } from '@nestjs/common';
import {
  provisionGideonUser,
  resolveActiveOrganizationId,
} from './gideon-oidc-provisioning';

const mockFindFirst = jest.fn();
const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockMemberFindFirst = jest.fn();
const mockOrgFindFirst = jest.fn();
const mockOrgFindUnique = jest.fn();

jest.mock('@db', () => ({
  db: {
    user: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    member: {
      findFirst: (...args: unknown[]) => mockMemberFindFirst(...args),
    },
    organization: {
      findFirst: (...args: unknown[]) => mockOrgFindFirst(...args),
      findUnique: (...args: unknown[]) => mockOrgFindUnique(...args),
    },
    session: { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
  },
}));

describe('provisionGideonUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('looks up the user by normalized email, case-insensitively', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'usr_1',
      banned: false,
      gideonSub: null,
    });
    mockUpdate.mockResolvedValue({ id: 'usr_1' });

    await provisionGideonUser({ sub: 'sub-1', email: 'Ada@Example.COM ' });

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'ada@example.com', mode: 'insensitive' } },
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('links a legacy mixed-case row instead of creating a duplicate', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'usr_legacy',
      email: 'Ada@Example.COM',
      banned: false,
      gideonSub: null,
    });
    mockUpdate.mockResolvedValue({ id: 'usr_legacy' });

    await provisionGideonUser({ sub: 'sub-1', email: 'ada@example.com' });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_legacy' },
      data: expect.objectContaining({ gideonSub: 'sub-1' }),
    });
  });

  it('stores a normalized email for new users', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'usr_new' });

    await provisionGideonUser({ sub: 'sub-1', email: 'Ada@Example.COM ' });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: 'ada@example.com' }),
    });
  });

  it('adopts the new email when the same sub presents a changed email', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockRejectedValue({ code: 'P2002' });
    mockFindUnique.mockResolvedValue({
      id: 'usr_old',
      email: 'old@example.com',
      banned: false,
      gideonSub: 'sub-1',
    });
    mockUpdate.mockResolvedValue({ id: 'usr_old' });

    const result = await provisionGideonUser({
      sub: 'sub-1',
      email: 'new@example.com',
    });

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { gideonSub: 'sub-1' },
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_old' },
      data: expect.objectContaining({ email: 'new@example.com' }),
    });
    expect(result).toEqual({ id: 'usr_old' });
  });

  it('rejects a banned account found by sub', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockRejectedValue({ code: 'P2002' });
    mockFindUnique.mockResolvedValue({
      id: 'usr_old',
      email: 'old@example.com',
      banned: true,
      gideonSub: 'sub-1',
    });

    await expect(
      provisionGideonUser({ sub: 'sub-1', email: 'new@example.com' }),
    ).rejects.toThrow(ForbiddenException);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('converts a link-path sub race into Forbidden instead of a 500', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'usr_1',
      banned: false,
      gideonSub: null,
    });
    mockUpdate.mockRejectedValue({ code: 'P2002' });

    await expect(
      provisionGideonUser({ sub: 'sub-1', email: 'ada@example.com' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rethrows when neither the email nor the sub matches', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockRejectedValue({ code: 'P2002' });
    mockFindUnique.mockResolvedValue(null);

    await expect(
      provisionGideonUser({ sub: 'sub-1', email: 'new@example.com' }),
    ).rejects.toEqual({ code: 'P2002' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('provisionGideonUser tenant stamping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stamps the login tenant on newly created users', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'usr_new' });

    await provisionGideonUser({
      sub: 'sub-1',
      email: 'new@example.com',
      tenantId: 'tenant-1',
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ gideonTenantId: 'tenant-1' }),
    });
  });

  it('refreshes the login tenant when linking an existing user', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'usr_1',
      banned: false,
      gideonSub: null,
    });
    mockUpdate.mockResolvedValue({ id: 'usr_1' });

    await provisionGideonUser({
      sub: 'sub-1',
      email: 'ada@example.com',
      tenantId: 'tenant-1',
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_1' },
      data: expect.objectContaining({ gideonTenantId: 'tenant-1' }),
    });
  });

  it('omits the tenant field when the login carries none', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'usr_new' });

    await provisionGideonUser({ sub: 'sub-1', email: 'new@example.com' });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.not.objectContaining({ gideonTenantId: expect.anything() }),
    });
  });
});

describe('resolveActiveOrganizationId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the tenant org id when the user is a member (tenant is the org)', async () => {
    mockOrgFindUnique.mockResolvedValue({ id: 'tenant-1' });
    mockMemberFindFirst.mockResolvedValue({ id: 'mem_1' });
    mockOrgFindFirst.mockResolvedValue({ id: 'org_recent' });

    await expect(
      resolveActiveOrganizationId({ userId: 'usr_1', tenantId: 'tenant-1' }),
    ).resolves.toBe('tenant-1');

    expect(mockOrgFindUnique).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      select: { id: true },
    });
    expect(mockMemberFindFirst).toHaveBeenCalledWith({
      where: {
        userId: 'usr_1',
        organizationId: 'tenant-1',
        deactivated: false,
        idpAccessRevoked: false,
      },
      select: { id: true },
    });
    expect(mockOrgFindFirst).not.toHaveBeenCalled();
  });

  it('resolves null for unknown tenants (setup flow, no most-recent fallback)', async () => {
    mockOrgFindUnique.mockResolvedValue(null);
    mockOrgFindFirst.mockResolvedValue({ id: 'org_recent' });

    await expect(
      resolveActiveOrganizationId({ userId: 'usr_1', tenantId: 'tenant-1' }),
    ).resolves.toBeNull();
    expect(mockMemberFindFirst).not.toHaveBeenCalled();
    expect(mockOrgFindFirst).not.toHaveBeenCalled();
  });

  it('resolves null when the user is not a member of the tenant org', async () => {
    mockOrgFindUnique.mockResolvedValue({ id: 'tenant-1' });
    mockMemberFindFirst.mockResolvedValue(null);
    mockOrgFindFirst.mockResolvedValue({ id: 'org_recent' });

    await expect(
      resolveActiveOrganizationId({ userId: 'usr_1', tenantId: 'tenant-1' }),
    ).resolves.toBeNull();
    expect(mockOrgFindFirst).not.toHaveBeenCalled();
  });

  it('uses most-recent when no tenant id is given (legacy path)', async () => {
    mockOrgFindFirst.mockResolvedValue({ id: 'org_recent' });

    await expect(
      resolveActiveOrganizationId({ userId: 'usr_1' }),
    ).resolves.toBe('org_recent');
    expect(mockOrgFindUnique).not.toHaveBeenCalled();
  });
});
