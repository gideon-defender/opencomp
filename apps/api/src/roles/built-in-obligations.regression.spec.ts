import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { db } from '@db';
import { RolesWriteService } from './roles-write.service';

jest.mock('@db', () => ({
  db: { organizationRole: { upsert: jest.fn(), findMany: jest.fn() } },
}));
jest.mock('@gideon-defender/auth', () => {
  const portal = ['read', 'update'];
  return {
    statement: { portal },
    allRoles: {
      owner: {},
      admin: {},
      auditor: {},
      employee: {},
      contractor: {},
    },
    BUILT_IN_ROLE_PERMISSIONS: {
      owner: { portal },
      admin: { portal },
      auditor: { app: ['read'] },
      employee: { portal },
      contractor: { portal },
    },
    BUILT_IN_ROLE_OBLIGATIONS: {
      owner: { compliance: true },
      admin: {},
      auditor: {},
      employee: { compliance: true },
      contractor: { compliance: true },
    },
  };
});

describe('built-in compliance opt-in', () => {
  const service = new RolesWriteService();
  const upsert = jest.mocked(db.organizationRole.upsert);
  beforeEach(() => jest.resetAllMocks());

  it.each(['owner', 'employee', 'contractor'])(
    'rejects an empty override that restores compliance for %s without portal permissions',
    async (name) => {
      await expect(
        service.setBuiltInObligations(
          'org_1',
          name,
          {},
          {
            roles: null,
            apiKeyScopes: ['ac:update'],
          },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(upsert).not.toHaveBeenCalled();
    },
  );

  it.each(['owner', 'employee', 'contractor'])(
    'permits an authorized empty override that restores compliance for %s',
    async (name) => {
      await expect(
        service.setBuiltInObligations('org_1', name, {}, { roles: ['owner'] }),
      ).resolves.toEqual({ name, obligations: { compliance: true } });
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { obligations: '{}' } }),
      );
    },
  );

  it.each(['owner', 'employee', 'contractor'])(
    'permits an explicit compliance opt-out for %s without portal permissions',
    async (name) => {
      await expect(
        service.setBuiltInObligations(
          'org_1',
          name,
          { compliance: false },
          { roles: null, apiKeyScopes: ['ac:update'] },
        ),
      ).resolves.toEqual({ name, obligations: { compliance: false } });
      expect(upsert).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects auditor opt-in before a write because auditors cannot use portal APIs', async () => {
    await expect(
      service.setBuiltInObligations(
        'org_1',
        'auditor',
        { compliance: true },
        { roles: ['owner'] },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin', 'employee', 'contractor'])(
    'permits opt-in for %s, whose fixed permissions include portal access',
    async (name) => {
      await expect(
        service.setBuiltInObligations(
          'org_1',
          name,
          { compliance: true },
          { roles: ['owner'] },
        ),
      ).resolves.toEqual({ name, obligations: { compliance: true } });
      expect(upsert).toHaveBeenCalledTimes(1);
    },
  );

  it('permits removal of an existing unsupported auditor obligation', async () => {
    await expect(
      service.setBuiltInObligations(
        'org_1',
        'auditor',
        { compliance: false },
        { roles: ['owner'] },
      ),
    ).resolves.toEqual({ name: 'auditor', obligations: { compliance: false } });
  });

  it('still rejects opt-in when the caller lacks portal permissions', async () => {
    await expect(
      service.setBuiltInObligations(
        'org_1',
        'admin',
        { compliance: true },
        { roles: ['auditor'] },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(upsert).not.toHaveBeenCalled();
  });
});
