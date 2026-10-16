import { db, type Prisma } from '@db';

/** Hold through the assignment write so definition removal cannot race it. */
export async function lockRoleAssignments({
  tx,
  organizationId,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
}): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${organizationId}, 92841))`;
}

export async function withRoleDefinitionLock<T>({
  organizationId,
  work,
}: {
  organizationId: string;
  work: (tx: Prisma.TransactionClient) => Promise<T>;
}): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 92841))`;
      return work(tx);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}
