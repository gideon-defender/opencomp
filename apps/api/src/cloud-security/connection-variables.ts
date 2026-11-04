import { db, Prisma } from '@db';

export class ConnectionNotFoundError extends Error {
  constructor() {
    super('Connection not found');
  }
}

export class ConcurrentVariableSaveError extends Error {
  constructor() {
    super(
      'Connection variables were modified by a concurrent request; please retry',
    );
    this.name = 'ConcurrentVariableSaveError';
  }
}

/**
 * Values storable in `IntegrationConnection.variables`. Simple scalars
 * (organization_id, subscription_id), string lists (project_ids), and
 * name maps (project_names keyed by project id / number).
 */
export type ConnectionVariableValue =
  string | string[] | Record<string, string>;

/**
 * Save multiple connection variables in a single read-modify-write.
 *
 * The write is conditioned on the exact snapshot that was read — an
 * optimistic-concurrency check on (id, organizationId, updatedAt). Each
 * commit sets updatedAt strictly above the snapshot it matched on, so a
 * committed write can never be matched by another writer holding that
 * same snapshot (even within one millisecond). If a concurrent writer
 * commits in between, the conditional write matches nothing, the
 * entries are re-merged onto the fresh snapshot, and the write is
 * retried. A writer therefore never silently drops another
 * writer's keys; per-key, the last committer wins. All keys land in one
 * UPDATE or none do. After repeated conflicts this throws
 * ConcurrentVariableSaveError instead of persisting a lost update.
 *
 * The read and the write both scope by organizationId so a connection id
 * from another tenant can never be read or written.
 */
export async function saveConnectionVariables(
  connectionId: string,
  entries: Record<string, ConnectionVariableValue>,
  organizationId: string,
): Promise<void> {
  if (Object.keys(entries).length === 0) return;

  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    const connection = await db.integrationConnection.findFirst({
      where: { id: connectionId, organizationId },
      select: { id: true, variables: true, updatedAt: true },
    });
    if (!connection) throw new ConnectionNotFoundError();

    const variables = (connection.variables as Record<string, unknown>) || {};
    // @updatedAt has millisecond precision; a plain new Date() could equal
    // the snapshot we matched, letting a rival writer's where clause land on
    // our committed row. Anchor strictly above the snapshot instead.
    const nextUpdatedAt = new Date(
      Math.max(Date.now(), connection.updatedAt.getTime() + 1),
    );
    const { count } = await db.integrationConnection.updateMany({
      where: {
        id: connectionId,
        organizationId,
        updatedAt: connection.updatedAt,
      },
      data: {
        variables: {
          ...variables,
          ...entries,
        } as unknown as Prisma.InputJsonValue,
        updatedAt: nextUpdatedAt,
      },
    });
    if (count === 1) return;
    if (attempt >= maxAttempts) {
      throw new ConcurrentVariableSaveError();
    }
  }
}

/** Save a single connection variable. Delegates to saveConnectionVariables. */
export async function saveConnectionVariable(
  connectionId: string,
  key: string,
  value: ConnectionVariableValue,
  organizationId: string,
): Promise<void> {
  await saveConnectionVariables(connectionId, { [key]: value }, organizationId);
}
