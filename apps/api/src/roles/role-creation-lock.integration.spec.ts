import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConflictException } from '@nestjs/common';
import { readSsoEntitlementRoles } from '../auth/sso-entitlement-roles';
import { RolesWriteService } from './roles-write.service';
import { withRoleDefinitionLock } from './role-assignment-lock';

const mockTransaction = jest.fn();
let mockClient: PrismaClient;
jest.mock('@db', () => ({
  db: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    get organizationRole() {
      return mockClient.organizationRole;
    },
    get member() {
      return mockClient.member;
    },
  },
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
suite('role creation PostgreSQL locks', () => {
  const schema = 'role_create_' + randomUUID().replaceAll('-', '');
  const organizationId = randomUUID();
  const caller = { roles: null, apiKeyScopes: ['control:read'] };
  const create = ({ name }: { name: string }) =>
    new RolesWriteService().createRole(
      organizationId,
      { name, permissions: { control: ['read'] } },
      caller,
    );
  beforeAll(async () => {
    mockClient = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }, { schema }),
    });
    await mockClient.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await mockClient.$executeRawUnsafe(`CREATE TABLE "${schema}".organization_role (
      id TEXT PRIMARY KEY DEFAULT md5(random()::text),
      "organizationId" TEXT NOT NULL, name TEXT NOT NULL,
      permissions TEXT NOT NULL, obligations TEXT NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      UNIQUE ("organizationId", name)
    )`);
    await mockClient.$executeRawUnsafe(`CREATE TABLE "${schema}"."Member" (
      id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, role TEXT NOT NULL
    )`);
  });
  beforeEach(async () => {
    mockTransaction.mockReset();
    mockTransaction.mockImplementation(
      (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        mockClient.$transaction(work, { timeout: 10_000 }),
    );
    await mockClient.$executeRawUnsafe(
      `TRUNCATE "${schema}".organization_role, "${schema}"."Member"`,
    );
  });
  afterAll(async () => {
    try {
      await mockClient.$executeRawUnsafe(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
      );
    } finally {
      await mockClient.$disconnect();
    }
  });

  async function waitForBlockedLock() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [row] = await mockClient.$queryRaw<Array<{ blocked: boolean }>>`
        SELECT EXISTS (SELECT 1 FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
          AND classid = ((hashtextextended(${organizationId}, 92841) >> 32) & 4294967295)::oid
          AND objid = (hashtextextended(${organizationId}, 92841) & 4294967295)::oid
        ) AS blocked`;
      if (row.blocked) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(
      'Expected a competing transaction to wait for the role lock',
    );
  }

  it('creation waits for a rename and rejects its case-only duplicate', async () => {
    const role = await mockClient.organizationRole.create({
      data: {
        organizationId,
        name: 'Senior',
        permissions: '{}',
        obligations: '{}',
      },
    });
    const changed = deferred();
    const release = deferred();
    const rename = withRoleDefinitionLock({
      organizationId,
      work: async (tx) => {
        await tx.organizationRole.update({
          where: { id: role.id },
          data: { name: 'Lead' },
        });
        changed.resolve();
        await release.promise;
      },
    });
    await changed.promise;
    const creation = create({ name: 'lead' }).catch((error: unknown) => error);
    try {
      await waitForBlockedLock();
    } finally {
      release.resolve();
      await rename;
      await creation;
    }
    expect(await creation).toBeInstanceOf(ConflictException);
    expect(
      await mockClient.organizationRole.findMany({ where: { organizationId } }),
    ).toEqual([expect.objectContaining({ name: 'Lead' })]);
  });

  it('serializes parallel case-only creates without deleting either committed role', async () => {
    const results = await Promise.allSettled([
      create({ name: 'Lead' }),
      create({ name: 'lead' }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason).toBeInstanceOf(
      ConflictException,
    );
    expect(
      await mockClient.organizationRole.count({ where: { organizationId } }),
    ).toBe(1);
  });

  it.each([false, true])(
    'an assignment waits for creation and observes only its committed result (abort=%s)',
    async (abort) => {
      const created = deferred();
      const release = deferred();
      mockTransaction.mockImplementationOnce(
        (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          mockClient.$transaction(
            async (tx) => {
              const result = await work(tx);
              created.resolve();
              await release.promise;
              if (abort) throw new Error('abort creation');
              return result;
            },
            { timeout: 10_000 },
          ),
      );
      const creation = create({ name: 'Lead' }).catch(
        (error: unknown) => error,
      );
      await created.promise;
      const assignment = mockClient.$transaction(async (tx) => {
        const { roles } = await readSsoEntitlementRoles({
          tx,
          tenantId: organizationId,
          entitlements: ['Lead'],
        });
        if (roles.length) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "${schema}"."Member" VALUES ('mem_1', $1, $2)`,
            organizationId,
            roles.join(','),
          );
        }
        return roles;
      });
      try {
        await waitForBlockedLock();
      } finally {
        release.resolve();
        await creation;
        await assignment;
      }
      expect(await assignment).toEqual(abort ? [] : ['Lead']);
      expect(await mockClient.member.count({ where: { organizationId } })).toBe(
        abort ? 0 : 1,
      );
      if (abort) expect(await creation).toEqual(new Error('abort creation'));
    },
  );
});
