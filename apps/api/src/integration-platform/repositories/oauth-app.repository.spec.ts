jest.mock('@db', () => ({
  Prisma:
    jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
      .Prisma,
  db: {
    integrationOAuthApp: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

import { Prisma } from '@db';
import type { db, IntegrationOAuthApp } from '@db';
import { OAuthAppRepository } from './oauth-app.repository';

type OAuthAppDbMock = {
  [Method in 'create' | 'findUnique' | 'updateMany' | 'upsert']: jest.Mock<
    Promise<Awaited<ReturnType<(typeof db.integrationOAuthApp)[Method]>>>,
    Parameters<(typeof db.integrationOAuthApp)[Method]>
  >;
};

const mockApp = jest.requireMock<{
  db: { integrationOAuthApp: OAuthAppDbMock };
}>('@db').db.integrationOAuthApp;
const repository = new OAuthAppRepository();
const credentials = {
  providerSlug: 'github',
  organizationId: 'org_a',
  encryptedClientId: { encrypted: 'client-id' },
  encryptedClientSecret: { encrypted: 'client-secret' },
  customScopes: ['read:user'],
  customSettings: { appName: 'shared-app' },
};
const rotation = {
  ...credentials,
  expectedVersion: 'v1',
  newVersion: 'v2',
};

function oauthApp(
  overrides: Partial<IntegrationOAuthApp> = {},
): IntegrationOAuthApp {
  return {
    id: 'ioa_1',
    ...credentials,
    managementSource: 'automation',
    automationVersion: 'v1',
    isActive: true,
    createdAt: new Date('2026-10-11T00:00:00Z'),
    updatedAt: new Date('2026-10-11T00:00:00Z'),
    ...overrides,
  };
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('Database write failed', {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });
}

beforeEach(() => jest.resetAllMocks());

describe('OAuthAppRepository customer ownership', () => {
  it('atomically takes customer ownership and clears the version on save', async () => {
    const customerRow = oauthApp({
      managementSource: 'customer',
      automationVersion: null,
    });
    mockApp.upsert.mockResolvedValue(customerRow);

    await expect(repository.upsert(credentials)).resolves.toEqual(customerRow);

    const customerData = {
      encryptedClientId: credentials.encryptedClientId,
      encryptedClientSecret: credentials.encryptedClientSecret,
      customScopes: credentials.customScopes,
      customSettings: credentials.customSettings,
      managementSource: 'customer',
      automationVersion: null,
      isActive: true,
    };
    expect(mockApp.upsert).toHaveBeenCalledWith({
      where: {
        providerSlug_organizationId: {
          providerSlug: 'github',
          organizationId: 'org_a',
        },
      },
      create: {
        ...customerData,
        providerSlug: 'github',
        organizationId: 'org_a',
      },
      update: customerData,
    });
  });
});

describe('OAuthAppRepository insert-if-absent', () => {
  it.each([true, false])(
    'preserves the source active status (%s) and provenance',
    async (isActive) => {
      const row = oauthApp({ isActive });
      mockApp.create.mockResolvedValue(row);
      const data = {
        ...credentials,
        managementSource: 'automation' as const,
        automationVersion: 'v1',
        isActive,
      };

      await expect(repository.createIfAbsent(data)).resolves.toEqual({
        created: true,
        row,
      });
      expect(mockApp.create).toHaveBeenCalledWith({ data });
      expect(mockApp.findUnique).not.toHaveBeenCalled();
      expect(mockApp.upsert).not.toHaveBeenCalled();
      expect(mockApp.updateMany).not.toHaveBeenCalled();
    },
  );

  it('returns the concurrent customer row on a duplicate insert without overwriting it', async () => {
    const customerRow = oauthApp({
      managementSource: 'customer',
      automationVersion: null,
      encryptedClientSecret: { encrypted: 'customer-secret' },
      isActive: false,
    });
    mockApp.create.mockRejectedValue(prismaError('P2002'));
    mockApp.findUnique.mockResolvedValue(customerRow);

    await expect(
      repository.createIfAbsent({
        ...credentials,
        managementSource: 'automation',
        automationVersion: 'v1',
      }),
    ).resolves.toEqual({ created: false, row: customerRow });
    expect(mockApp.findUnique).toHaveBeenCalledWith({
      where: {
        providerSlug_organizationId: {
          providerSlug: 'github',
          organizationId: 'org_a',
        },
      },
    });
    expect(mockApp.create).toHaveBeenCalledTimes(1);
    expect(mockApp.upsert).not.toHaveBeenCalled();
    expect(mockApp.updateMany).not.toHaveBeenCalled();
  });

  it('rethrows a duplicate error when the competing row has disappeared', async () => {
    const error = prismaError('P2002');
    mockApp.create.mockRejectedValue(error);
    mockApp.findUnique.mockResolvedValue(null);

    await expect(repository.createIfAbsent(credentials)).rejects.toBe(error);
  });

  it('does not treat other database errors as duplicate inserts', async () => {
    const error = prismaError('P2003');
    mockApp.create.mockRejectedValue(error);

    await expect(repository.createIfAbsent(credentials)).rejects.toBe(error);
    expect(mockApp.findUnique).not.toHaveBeenCalled();
  });
});

describe('OAuthAppRepository conditional rotation', () => {
  it.each([
    {
      name: 'customer takeover',
      overrides: { managementSource: 'customer', automationVersion: null },
    },
    { name: 'stale version', overrides: { automationVersion: 'v2' } },
    { name: 'foreign organization', overrides: { organizationId: 'org_b' } },
    { name: 'different provider', overrides: { providerSlug: 'slack' } },
  ])('does not change a row after $name', async ({ overrides }) => {
    const row = oauthApp(overrides);
    const before = { ...row };
    mockApp.updateMany.mockImplementation(async ({ where, data }) => {
      const matches = Object.entries(where ?? {}).every(
        ([field, value]) => Reflect.get(row, field) === value,
      );
      if (!matches) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    });

    await expect(repository.updateAutomationRow(rotation)).resolves.toBe(0);
    expect(row).toEqual(before);
  });

  it.each([true, false])(
    'rotates the matching row while preserving isActive=%s',
    async (isActive) => {
      const row = oauthApp({
        isActive,
        encryptedClientSecret: { encrypted: 'old-secret' },
      });
      mockApp.updateMany.mockImplementation(async ({ where, data }) => {
        const matches = Object.entries(where ?? {}).every(
          ([field, value]) => Reflect.get(row, field) === value,
        );
        if (!matches) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      });

      await expect(repository.updateAutomationRow(rotation)).resolves.toBe(1);
      expect(row).toMatchObject({
        encryptedClientId: credentials.encryptedClientId,
        encryptedClientSecret: credentials.encryptedClientSecret,
        customScopes: credentials.customScopes,
        customSettings: credentials.customSettings,
        managementSource: 'automation',
        automationVersion: 'v2',
        isActive,
      });
      expect(mockApp.updateMany).toHaveBeenCalledWith({
        where: {
          providerSlug: 'github',
          organizationId: 'org_a',
          managementSource: 'automation',
          automationVersion: 'v1',
        },
        data: {
          encryptedClientId: credentials.encryptedClientId,
          encryptedClientSecret: credentials.encryptedClientSecret,
          customScopes: credentials.customScopes,
          customSettings: credentials.customSettings,
          automationVersion: 'v2',
        },
      });
    },
  );
});
