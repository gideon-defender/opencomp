jest.mock('@db', () => ({
  db: {
    integrationConnection: { findFirst: jest.fn(), updateMany: jest.fn() },
  },
  Prisma: {},
}));

import { db } from '@db';
import {
  saveConnectionVariable,
  saveConnectionVariables,
  ConnectionNotFoundError,
  ConcurrentVariableSaveError,
} from './connection-variables';

const connection = db as unknown as {
  integrationConnection: { findFirst: jest.Mock; updateMany: jest.Mock };
};

const SNAPSHOT = new Date('2026-01-01T00:00:00.000Z');

describe('saveConnectionVariables', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('no-ops for an empty entry set without reading the connection', async () => {
    await saveConnectionVariables('conn_1', {}, 'org_1');
    expect(connection.integrationConnection.findFirst).not.toHaveBeenCalled();
    expect(connection.integrationConnection.updateMany).not.toHaveBeenCalled();
  });

  it('scopes both the read and the write by organizationId', async () => {
    connection.integrationConnection.findFirst.mockResolvedValueOnce({
      id: 'conn_1',
      variables: {},
      updatedAt: SNAPSHOT,
    });
    connection.integrationConnection.updateMany.mockResolvedValueOnce({
      count: 1,
    });

    await saveConnectionVariables('conn_1', { k: 'v' }, 'org_1');

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

  it('throws ConnectionNotFoundError and writes nothing when missing', async () => {
    connection.integrationConnection.findFirst.mockResolvedValueOnce(null);

    await expect(
      saveConnectionVariables('conn_1', { k: 'v' }, 'org_1'),
    ).rejects.toBeInstanceOf(ConnectionNotFoundError);
    expect(connection.integrationConnection.updateMany).not.toHaveBeenCalled();
  });

  it('throws ConcurrentVariableSaveError after three failed attempts', async () => {
    connection.integrationConnection.findFirst.mockResolvedValue({
      id: 'conn_1',
      variables: {},
      updatedAt: SNAPSHOT,
    });
    connection.integrationConnection.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      saveConnectionVariables('conn_1', { k: 'v' }, 'org_1'),
    ).rejects.toBeInstanceOf(ConcurrentVariableSaveError);
    expect(connection.integrationConnection.updateMany).toHaveBeenCalledTimes(
      3,
    );
  });

  it('delegates saveConnectionVariable to saveConnectionVariables', async () => {
    connection.integrationConnection.findFirst.mockResolvedValueOnce({
      id: 'conn_1',
      variables: {},
      updatedAt: SNAPSHOT,
    });
    connection.integrationConnection.updateMany.mockResolvedValueOnce({
      count: 1,
    });

    await saveConnectionVariable(
      'conn_1',
      'organization_id',
      'org_gcp',
      'org_1',
    );

    const update = connection.integrationConnection.updateMany.mock.calls[0][0];
    expect(update.data.variables.organization_id).toBe('org_gcp');
  });
});
