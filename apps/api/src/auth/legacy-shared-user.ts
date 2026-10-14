import { db, type Prisma, type User } from '@db';

/** Shared rows remain readable only while the legacy global email key exists. */
export async function findLegacySharedUser({
  tenantId,
  normalizedEmail,
  sub,
  purpose = 'authentication',
  client = db,
}: {
  tenantId: string;
  normalizedEmail: string;
  sub: string;
  purpose?: 'authentication' | 'hr-sync';
  client?: Pick<Prisma.TransactionClient, '$queryRaw'>;
}): Promise<User | undefined> {
  const rows = await client.$queryRaw<User[]>`
    SELECT u.* FROM "User" u
    JOIN "Member" m ON m."userId" = u.id
    WHERE m."organizationId" = ${tenantId}
      -- HR must resolve an existing membership before it can reactivate it.
      AND (${purpose === 'hr-sync'} OR (m."deactivated" = false AND m."isActive" = true))
      AND u."tenantId" IS NOT NULL AND u."tenantId" <> ${tenantId}
      -- Email can locate HR state, but must never authenticate another subject.
      AND (u."gideonSub" = ${sub}
        OR (${purpose === 'hr-sync'} AND lower(u.email) = ${normalizedEmail}))
      AND EXISTS (
        SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE i.indrelid = '"User"'::regclass AND i.indisunique AND i.indisvalid
          AND c.relname = 'User_email_key'
      )
    LIMIT 1
  `;
  const user = rows[0];
  return user && !user.banned ? user : undefined;
}
