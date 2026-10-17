import { invalidateTenantSessions, syncSsoMember } from './sso-member-sync';

jest.mock('@db', () => ({
  db: {
    $transaction: jest.fn(),
    member: { findFirst: jest.fn(), update: jest.fn() },
    session: { deleteMany: jest.fn() },
  },
}));

const { db } = require('@db') as {
  db: {
    $transaction: jest.Mock;
    member: { findFirst: jest.Mock; update: jest.Mock };
    session: { deleteMany: jest.Mock };
  };
};

const txMember = {
  findFirst: jest.fn(),
  update: jest.fn(),
  create: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  db.$transaction.mockImplementation((fn: unknown) =>
    (fn as (tx: unknown) => unknown)({
      member: txMember,
      $executeRaw: jest.fn(),
      organizationRole: { findMany: jest.fn().mockResolvedValue([]) },
    }),
  );
});

describe('syncSsoMember', () => {
  it('rejects a custom role removed after token validation without writing a member', async () => {
    await expect(
      syncSsoMember({
        userId: 'usr_1',
        organizationId: 'tenant-1',
        roles: ['Removed Lead'],
      }),
    ).rejects.toThrow('role definition changed');
    expect(txMember.update).not.toHaveBeenCalled();
    expect(txMember.create).not.toHaveBeenCalled();
  });

  it('creates the member row on first login with sso source', async () => {
    txMember.findFirst.mockResolvedValue(null);
    txMember.create.mockResolvedValue({ id: 'mem_new' });

    await syncSsoMember({
      userId: 'usr_1',
      organizationId: 'tenant-1',
      roles: ['admin'],
    });

    expect(txMember.create).toHaveBeenCalledWith({
      data: {
        userId: 'usr_1',
        organizationId: 'tenant-1',
        role: 'admin',
        roleSource: 'sso',
        idpAccessRevoked: false,
      },
    });
  });

  it('overwrites a locally-added role and stamps sso source', async () => {
    txMember.findFirst.mockResolvedValue({ id: 'mem_1' });
    txMember.update.mockResolvedValue({ id: 'mem_1' });

    await syncSsoMember({
      userId: 'usr_1',
      organizationId: 'tenant-1',
      roles: ['employee'],
    });

    expect(txMember.update).toHaveBeenCalledWith({
      where: { id: 'mem_1' },
      data: { role: 'employee', roleSource: 'sso', idpAccessRevoked: false },
    });
  });

  it('demotes an existing local owner to the IdP employee set', async () => {
    txMember.findFirst.mockResolvedValue({ id: 'mem_1' });
    txMember.update.mockResolvedValue({ id: 'mem_1' });

    await syncSsoMember({
      userId: 'usr_1',
      organizationId: 'tenant-1',
      roles: ['employee'],
    });

    const data = txMember.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data['role']).toBe('employee');
    // Only the three SSO-managed fields — deactivated/HR fields untouched.
    expect(Object.keys(data).sort()).toEqual(
      ['idpAccessRevoked', 'role', 'roleSource'].sort(),
    );
  });

  it('dedupes the presented set before writing', async () => {
    txMember.findFirst.mockResolvedValue({ id: 'mem_1' });
    txMember.update.mockResolvedValue({ id: 'mem_1' });

    await syncSsoMember({
      userId: 'usr_1',
      organizationId: 'tenant-1',
      roles: ['admin', 'admin', ' auditor '],
    });

    expect(txMember.update).toHaveBeenCalledWith({
      where: { id: 'mem_1' },
      data: {
        role: 'admin,auditor',
        roleSource: 'sso',
        idpAccessRevoked: false,
      },
    });
  });

  it('refuses an empty role set without writing', async () => {
    await expect(
      syncSsoMember({ userId: 'usr_1', organizationId: 'tenant-1', roles: [] }),
    ).rejects.toThrow();
    await expect(
      syncSsoMember({
        userId: 'usr_1',
        organizationId: 'tenant-1',
        roles: ['   '],
      }),
    ).rejects.toThrow();
    expect(txMember.create).not.toHaveBeenCalled();
    expect(txMember.update).not.toHaveBeenCalled();
  });

  it('survives a concurrent first-login P2002 via re-read + update', async () => {
    txMember.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'mem_raced' });
    txMember.create.mockRejectedValue({ code: 'P2002' });
    db.member.findFirst.mockResolvedValue({ id: 'mem_raced' });
    txMember.update.mockResolvedValue({ id: 'mem_raced' });

    await syncSsoMember({
      userId: 'usr_1',
      organizationId: 'tenant-1',
      roles: ['admin'],
    });

    expect(txMember.update).toHaveBeenCalledWith({
      where: { id: 'mem_raced' },
      data: { role: 'admin', roleSource: 'sso', idpAccessRevoked: false },
    });
    expect(txMember.create).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.member.update).not.toHaveBeenCalled();
  });

  it('rethrows the original P2002 when the re-read finds no row', async () => {
    txMember.findFirst.mockResolvedValue(null);
    const conflict = { code: 'P2002' };
    txMember.create.mockRejectedValue(conflict);
    db.member.findFirst.mockResolvedValue(null);

    await expect(
      syncSsoMember({
        userId: 'usr_1',
        organizationId: 'tenant-1',
        roles: ['admin'],
      }),
    ).rejects.toBe(conflict);
    expect(db.member.update).not.toHaveBeenCalled();
  });

  it('rethrows non-P2002 transaction failures without a second write', async () => {
    txMember.findFirst.mockRejectedValue(new Error('db down'));

    await expect(
      syncSsoMember({
        userId: 'usr_1',
        organizationId: 'tenant-1',
        roles: ['admin'],
      }),
    ).rejects.toThrow('db down');
    expect(db.member.findFirst).not.toHaveBeenCalled();
  });
});

describe('invalidateTenantSessions', () => {
  it('deletes sessions of tenant members and reports the count', async () => {
    db.session.deleteMany.mockResolvedValue({ count: 7 });

    const result = await invalidateTenantSessions({ tenantId: 'tenant-1' });

    expect(db.session.deleteMany).toHaveBeenCalledWith({
      where: { user: { members: { some: { organizationId: 'tenant-1' } } } },
    });
    expect(result).toEqual({ deleted: 7 });
  });
});
