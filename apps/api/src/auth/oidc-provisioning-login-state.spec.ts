jest.mock('./legacy-shared-user', () => ({
  findLegacySharedUser: jest.fn().mockResolvedValue(undefined),
}));
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { provisionOidcUser } from './oidc-provisioning';

const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockQueryRaw = jest.fn();
const mockMemberFindFirst = jest.fn();
const mockOrgFindFirst = jest.fn();
const mockOrgFindUnique = jest.fn();

jest.mock('@db', () => ({
  // normalizeEmail is used by the implementation; keep the mock faithful.
  normalizeEmail: jest.requireActual('@gideon-defender/email').normalizeEmail,
  db: {
    user: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
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
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

const TENANT_A = 'tenant-a';

describe('provisionOidcUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no canonical subject link yet.
    mockFindUnique.mockResolvedValue(null);
    // Default: no expand-window candidates.
    mockQueryRaw.mockResolvedValue([]);
  });

  it('adopts the IdP email change on a subject hit when the address is free', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'usr_a',
      email: 'old@example.com',
      banned: false,
      gideonSub: 'sub-a',
      tenantId: TENANT_A,
    });
    mockFindFirst.mockResolvedValue(null);
    mockUpdate.mockResolvedValue({ id: 'usr_a' });

    await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-a',
      email: 'new@example.com',
      tenantId: TENANT_A,
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_a' },
      data: expect.objectContaining({ email: 'new@example.com' }),
    });
  });

  it('keeps the existing email on a subject hit when the new address collides', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'usr_a',
      email: 'old@example.com',
      banned: false,
      gideonSub: 'sub-a',
      tenantId: TENANT_A,
    });
    mockFindFirst.mockResolvedValue({ id: 'usr_other', tenantId: TENANT_A });
    mockUpdate.mockResolvedValue({ id: 'usr_a' });

    const result = await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-a',
      email: 'taken@example.com',
      tenantId: TENANT_A,
    });

    // Login proceeds; the collision is logged for HR sync to resolve.
    expect(result).toEqual({ id: 'usr_a' });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_a' },
      data: expect.not.objectContaining({ email: expect.anything() }),
    });
  });

  it('keeps the existing email when adoption races a concurrent write', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'usr_a',
      email: 'old@example.com',
      banned: false,
      gideonSub: 'sub-a',
      tenantId: TENANT_A,
    });
    mockFindFirst.mockResolvedValue(null);
    mockUpdate
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValue({ id: 'usr_a' });

    const result = await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-a',
      email: 'new@example.com',
      tenantId: TENANT_A,
    });

    expect(result).toEqual({ id: 'usr_a' });
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenLastCalledWith({
      where: { id: 'usr_a' },
      data: expect.not.objectContaining({ email: expect.anything() }),
    });
  });

  it('leaves ownership unresolved when the expand-window claim collides', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'usr_a',
      email: 'person@example.com',
      banned: false,
      gideonSub: 'sub-a',
      tenantId: null,
    });
    mockFindFirst.mockResolvedValue(null);
    mockUpdate
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValue({ id: 'usr_a' });

    const result = await provisionOidcUser({
      emailVerified: true,
      sub: 'sub-a',
      email: 'person@example.com',
      tenantId: TENANT_A,
    });

    // Login proceeds; the duplicate stays for explicit resolution.
    expect(result).toEqual({ id: 'usr_a' });
    expect(mockUpdate).toHaveBeenCalledTimes(3);
    expect(mockUpdate).toHaveBeenLastCalledWith({
      where: { id: 'usr_a' },
      data: expect.not.objectContaining({ tenantId: expect.anything() }),
    });
  });

  it('rejects a banned account found by sub', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'usr_old',
      email: 'old@example.com',
      banned: true,
      gideonSub: 'sub-1',
      tenantId: TENANT_A,
    });

    await expect(
      provisionOidcUser({
        emailVerified: true,
        sub: 'sub-1',
        email: 'new@example.com',
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('converts a link-path sub race into Forbidden instead of a 500', async () => {
    mockFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'usr_other' });
    mockFindFirst.mockResolvedValue({
      id: 'usr_1',
      banned: false,
      gideonSub: null,
      tenantId: TENANT_A,
    });
    mockUpdate.mockRejectedValue({ code: 'P2002' });

    await expect(
      provisionOidcUser({
        emailVerified: true,
        sub: 'sub-1',
        email: 'ada@example.com',
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('reports a retryable conflict when the link-path claim collides within the tenant', async () => {
    // The subject is free, but claiming the null-tenant row collides with
    // the tenant's existing composite key — retryable, not a link conflict.
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue({
      id: 'usr_1',
      banned: false,
      gideonSub: null,
      tenantId: null,
    });
    mockUpdate.mockRejectedValue({ code: 'P2002' });

    await expect(
      provisionOidcUser({
        emailVerified: true,
        sub: 'sub-1',
        email: 'ada@example.com',
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('reports a retryable conflict when the race winner vanishes', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockRejectedValue({ code: 'P2002' });

    await expect(
      provisionOidcUser({
        emailVerified: true,
        sub: 'sub-1',
        email: 'new@example.com',
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(ConflictException);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
