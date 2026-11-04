jest.mock('@db', () => ({
  db: {
    integrationConnection: { findFirst: jest.fn(), updateMany: jest.fn() },
  },
  Prisma: {},
}));

import { db } from '@db';
import {
  CloudSecurityService,
  ConnectionNotFoundError,
  ConcurrentVariableSaveError,
} from './cloud-security.service';

type Ctor = ConstructorParameters<typeof CloudSecurityService>;

const connection = db as unknown as {
  integrationConnection: { findFirst: jest.Mock; updateMany: jest.Mock };
};

const SNAPSHOT = new Date('2026-01-01T00:00:00.000Z');

describe('CloudSecurityService.saveConnectionVariables', () => {
  let service: CloudSecurityService;

  beforeEach(() => {
    service = new CloudSecurityService(
      {} as unknown as Ctor[0],
      {} as unknown as Ctor[1],
      {} as unknown as Ctor[2],
      {} as unknown as Ctor[3],
      {} as unknown as Ctor[4],
      {} as unknown as Ctor[5],
    );
    jest.clearAllMocks();
  });

  it('writes every entry in a single merged update conditioned on the read snapshot', async () => {
    connection.integrationConnection.findFirst.mockResolvedValueOnce({
      id: 'conn_1',
      variables: { organization_id: 'org_old', other: 'keep' },
      updatedAt: SNAPSHOT,
    });
    connection.integrationConnection.updateMany.mockResolvedValueOnce({
      count: 1,
    });

    await service.saveConnectionVariables(
      'conn_1',
      {
        organization_id: 'org_new',
        project_ids: ['prj-1', 'prj-2'],
        project_names: { 'prj-1': 'Payments', '123': 'Payments' },
      },
      'org_1',
    );

    expect(connection.integrationConnection.findFirst).toHaveBeenCalledTimes(1);
    expect(connection.integrationConnection.updateMany).toHaveBeenCalledTimes(
      1,
    );
    expect(connection.integrationConnection.updateMany).toHaveBeenCalledWith({
      where: { id: 'conn_1', organizationId: 'org_1', updatedAt: SNAPSHOT },
      data: {
        variables: {
          organization_id: 'org_new',
          other: 'keep',
          project_ids: ['prj-1', 'prj-2'],
          project_names: { 'prj-1': 'Payments', '123': 'Payments' },
        },
        updatedAt: expect.any(Date),
      },
    });
  });

  it('stores a Record<string, string> value verbatim (no cast needed)', async () => {
    connection.integrationConnection.findFirst.mockResolvedValueOnce({
      id: 'conn_1',
      variables: {},
      updatedAt: SNAPSHOT,
    });
    connection.integrationConnection.updateMany.mockResolvedValueOnce({
      count: 1,
    });

    await service.saveConnectionVariable(
      'conn_1',
      'project_names',
      { 'prj-1': 'Payments' },
      'org_1',
    );

    const update = connection.integrationConnection.updateMany.mock.calls[0][0];
    expect(update.data.variables.project_names).toEqual({
      'prj-1': 'Payments',
    });
  });

  it('stamps updatedAt strictly above the snapshot, even within the same millisecond', async () => {
    // Simulate a winner committing in the same millisecond the snapshot was
    // taken: Date.now() === SNAPSHOT inside the write. The stored timestamp
    // must still fence out the snapshot, or a competing writer holding this
    // exact snapshot would match our committed row and overwrite it.
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(SNAPSHOT.getTime());
    try {
      connection.integrationConnection.findFirst.mockResolvedValueOnce({
        id: 'conn_1',
        variables: {},
        updatedAt: SNAPSHOT,
      });
      connection.integrationConnection.updateMany.mockResolvedValueOnce({
        count: 1,
      });

      await service.saveConnectionVariables('conn_1', { k: 'v' }, 'org_1');

      const update =
        connection.integrationConnection.updateMany.mock.calls[0][0];
      expect(update.data.updatedAt.getTime()).toBe(SNAPSHOT.getTime() + 1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('uses the wall clock when it is already ahead of the snapshot', async () => {
    const later = new Date('2026-01-02T00:00:00.000Z');
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(later.getTime());
    try {
      connection.integrationConnection.findFirst.mockResolvedValueOnce({
        id: 'conn_1',
        variables: {},
        updatedAt: SNAPSHOT,
      });
      connection.integrationConnection.updateMany.mockResolvedValueOnce({
        count: 1,
      });

      await service.saveConnectionVariables('conn_1', { k: 'v' }, 'org_1');

      const update =
        connection.integrationConnection.updateMany.mock.calls[0][0];
      expect(update.data.updatedAt.getTime()).toBe(later.getTime());
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('re-merges onto the fresh snapshot when a concurrent writer wins the first attempt', async () => {
    // Attempt 1: reads stale snapshot, but loses the conditional write.
    connection.integrationConnection.findFirst.mockResolvedValueOnce({
      id: 'conn_1',
      variables: { organization_id: 'org_old' },
      updatedAt: SNAPSHOT,
    });
    connection.integrationConnection.updateMany.mockResolvedValueOnce({
      count: 0,
    });
    // Attempt 2: the competing writer's project_ids is now visible — keep it.
    const fresh = new Date('2026-01-01T00:00:05.000Z');
    connection.integrationConnection.findFirst.mockResolvedValueOnce({
      id: 'conn_1',
      variables: {
        organization_id: 'org_old',
        project_ids: ['prj-winner'],
      },
      updatedAt: fresh,
    });
    connection.integrationConnection.updateMany.mockResolvedValueOnce({
      count: 1,
    });

    await service.saveConnectionVariables(
      'conn_1',
      { organization_id: 'org_new' },
      'org_1',
    );

    expect(connection.integrationConnection.updateMany).toHaveBeenCalledTimes(
      2,
    );
    const second = connection.integrationConnection.updateMany.mock.calls[1][0];
    expect(second.where).toEqual({
      id: 'conn_1',
      organizationId: 'org_1',
      updatedAt: fresh,
    });
    // The concurrent writer's key survives the retry merge.
    expect(second.data.variables).toEqual({
      organization_id: 'org_new',
      project_ids: ['prj-winner'],
    });
  });

  it('throws ConcurrentVariableSaveError instead of persisting a lost update when conflicts persist', async () => {
    connection.integrationConnection.findFirst.mockResolvedValue({
      id: 'conn_1',
      variables: {},
      updatedAt: SNAPSHOT,
    });
    connection.integrationConnection.updateMany.mockResolvedValue({
      count: 0,
    });

    await expect(
      service.saveConnectionVariables(
        'conn_1',
        { organization_id: 'org_new' },
        'org_1',
      ),
    ).rejects.toBeInstanceOf(ConcurrentVariableSaveError);

    expect(connection.integrationConnection.updateMany).toHaveBeenCalledTimes(
      3,
    );
  });

  it('no-ops for an empty entry set', async () => {
    await service.saveConnectionVariables('conn_1', {}, 'org_1');

    expect(connection.integrationConnection.findFirst).not.toHaveBeenCalled();
    expect(connection.integrationConnection.updateMany).not.toHaveBeenCalled();
  });

  it('throws ConnectionNotFoundError and writes nothing when the connection is missing', async () => {
    connection.integrationConnection.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.saveConnectionVariables(
        'conn_1',
        { organization_id: 'org' },
        'org_1',
      ),
    ).rejects.toBeInstanceOf(ConnectionNotFoundError);

    expect(connection.integrationConnection.updateMany).not.toHaveBeenCalled();
  });

  it('scopes the lookup and the write by organizationId (tenant isolation)', async () => {
    connection.integrationConnection.findFirst.mockResolvedValueOnce({
      id: 'conn_1',
      variables: {},
      updatedAt: SNAPSHOT,
    });
    connection.integrationConnection.updateMany.mockResolvedValueOnce({
      count: 1,
    });

    await service.saveConnectionVariables('conn_1', { k: 'v' }, 'org_1');

    expect(connection.integrationConnection.findFirst).toHaveBeenCalledWith({
      where: { id: 'conn_1', organizationId: 'org_1' },
      select: { id: true, variables: true, updatedAt: true },
    });
    expect(connection.integrationConnection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conn_1', organizationId: 'org_1', updatedAt: SNAPSHOT },
      }),
    );
  });
});
