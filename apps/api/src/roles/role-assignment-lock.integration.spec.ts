import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { readSsoEntitlementRoles } from '../auth/sso-entitlement-roles';
import { RolesWriteService } from './roles-write.service';
import { RolesUpdateService } from './roles-update.service';
import { withRoleDefinitionLock } from './role-assignment-lock';

const mockTransaction = jest.fn();
jest.mock('@db', () => ({
  db: { $transaction: (...args: unknown[]) => mockTransaction(...args) },
}));
jest.mock('@gideon-defender/auth', () => ({
  allRoles: { owner: {} },
  BUILT_IN_ROLE_PERMISSIONS: { owner: {} },
  BUILT_IN_ROLE_OBLIGATIONS: {},
  statement: { control: ['read'] },
}));

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const databaseUrl = process.env.ROLE_ASSIGNMENT_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
suite('role definition and assignment PostgreSQL locks', () => {
  const schema = 'role_race_' + randomUUID().replaceAll('-', '');
  const organizationId = randomUUID();
  let client: PrismaClient;
  beforeAll(async () => {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }, { schema }),
    });
    await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await client.$executeRawUnsafe(`CREATE TABLE "${schema}".organization_role (
      id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, name TEXT NOT NULL,
      permissions TEXT NOT NULL, obligations TEXT NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
    )`);
    await client.$executeRawUnsafe(`CREATE TABLE "${schema}"."Member" (
      id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, role TEXT NOT NULL
    )`);
    mockTransaction.mockImplementation(
      (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        client.$transaction(work, { timeout: 10_000 }),
    );
  });
  beforeEach(async () => {
    await client.$executeRawUnsafe(
      `TRUNCATE "${schema}".organization_role, "${schema}"."Member"`,
    );
    await client.organizationRole.create({
      data: {
        id: 'rol_1',
        organizationId,
        name: 'Lead',
        permissions: '{"control":["read"]}',
        obligations: '{}',
      },
    });
  });
  afterAll(async () => {
    try {
      await client.$executeRawUnsafe(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
      );
    } finally {
      await client.$disconnect();
    }
  });

  async function waitForBlockedLock() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [row] = await client.$queryRaw<Array<{ blocked: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
          AND classid = ((hashtextextended(${organizationId}, 92841) >> 32) & 4294967295)::oid
          AND objid = (hashtextextended(${organizationId}, 92841) & 4294967295)::oid
        ) AS blocked`;
      if (row.blocked) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(
      'Expected a competing transaction to wait for the role lock',
    );
  }

  it.each(['delete', 'rename'] as const)(
    '%s waits for an assignment and rejects after the member becomes a holder',
    async (operation) => {
      const read = deferred();
      const release = deferred();
      const assignment = client.$transaction(
        async (tx) => {
          const { roles } = await readSsoEntitlementRoles({
            tx,
            tenantId: organizationId,
            entitlements: ['Lead'],
          });
          read.resolve();
          await release.promise;
          await tx.$executeRawUnsafe(
            `INSERT INTO "${schema}"."Member" VALUES ('mem_1', $1, $2)`,
            organizationId,
            roles.join(','),
          );
        },
        { timeout: 10_000 },
      );
      await read.promise;
      const mutation =
        operation === 'delete'
          ? new RolesWriteService().deleteRole(organizationId, 'rol_1')
          : new RolesUpdateService().updateRole(
              organizationId,
              'rol_1',
              { name: 'Senior Lead' },
              { roles: null, apiKeyScopes: ['control:read'] },
            );
      const result = mutation.then(
        () => undefined,
        (error: unknown) => error,
      );
      try {
        await waitForBlockedLock();
      } finally {
        release.resolve();
      }
      await assignment;
      expect(await result).toBeInstanceOf(
        operation === 'delete' ? ConflictException : BadRequestException,
      );
      expect(
        await client.organizationRole.findUnique({ where: { id: 'rol_1' } }),
      ).toMatchObject({ name: 'Lead' });
    },
  );

  it.each(['delete', 'rename'] as const)(
    'an assignment waits for %s and discards the removed name after commit',
    async (operation) => {
      const changed = deferred();
      const release = deferred();
      const mutation = withRoleDefinitionLock({
        organizationId,
        work: async (tx) => {
          if (operation === 'delete')
            await tx.organizationRole.delete({ where: { id: 'rol_1' } });
          else
            await tx.organizationRole.update({
              where: { id: 'rol_1' },
              data: { name: 'Senior Lead' },
            });
          changed.resolve();
          await release.promise;
        },
      });
      await changed.promise;
      const assignment = client.$transaction((tx) =>
        readSsoEntitlementRoles({
          tx,
          tenantId: organizationId,
          entitlements: ['Lead'],
        }),
      );
      try {
        await waitForBlockedLock();
      } finally {
        release.resolve();
      }
      await mutation;
      expect((await assignment).roles).toEqual([]);
    },
  );

  it('does not block an assignment in another tenant', async () => {
    const held = deferred();
    const release = deferred();
    const mutation = withRoleDefinitionLock({
      organizationId,
      work: async () => {
        held.resolve();
        await release.promise;
      },
    });
    await held.promise;
    try {
      const result = await client.$transaction(
        (tx) =>
          readSsoEntitlementRoles({
            tx,
            tenantId: randomUUID(),
            entitlements: ['Lead'],
          }),
        { timeout: 1_000 },
      );
      expect(result.roles).toEqual([]);
    } finally {
      release.resolve();
      await mutation;
    }
  });

  it('releases the lock and rolls back a failed definition change', async () => {
    await expect(
      withRoleDefinitionLock({
        organizationId,
        work: async (tx) => {
          await tx.organizationRole.delete({ where: { id: 'rol_1' } });
          throw new Error('abort');
        },
      }),
    ).rejects.toThrow('abort');
    const result = await client.$transaction((tx) =>
      readSsoEntitlementRoles({
        tx,
        tenantId: organizationId,
        entitlements: ['Lead'],
      }),
    );
    expect(result.roles).toEqual(['Lead']);
  });
});
