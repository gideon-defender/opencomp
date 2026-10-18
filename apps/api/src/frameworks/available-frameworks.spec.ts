jest.mock('@db', () => ({
  db: {
    member: { findFirst: jest.fn() },
    frameworkEditorFramework: { findMany: jest.fn() },
    customFramework: { findMany: jest.fn() },
  },
}));

import { db } from '@db';
import { findAvailableFrameworks } from './available-frameworks';

const mockMember = jest.mocked(db.member.findFirst);
const mockPlatform = jest.mocked(db.frameworkEditorFramework.findMany);
const mockCustom = jest.mocked(db.customFramework.findMany);
const context = {
  organizationId: 'org_tenant',
  userId: 'usr_1',
  authType: 'session' as const,
};
const timestamps = {
  createdAt: new Date('2026-10-17T00:00:00Z'),
  updatedAt: new Date('2026-10-17T00:00:00Z'),
};
const platform = {
  ...timestamps,
  id: 'frk_1',
  name: 'SOC 2',
  version: '1.0',
  description: 'Platform framework',
  visible: true,
  familyId: null,
  requirements: [],
};
const custom = {
  ...timestamps,
  id: 'cfrm_1',
  name: 'Private',
  version: '1.0',
  description: 'Private framework',
  organizationId: 'org_tenant',
  requirements: [{ id: 'req_1' }],
};

describe('available framework membership', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockPlatform.mockResolvedValue([platform]);
    mockCustom.mockResolvedValue([custom]);
    mockMember.mockResolvedValue(null);
  });

  it('returns only platform frameworks for a tenant-owned session without membership', async () => {
    const result = await findAvailableFrameworks(context);

    expect(result).toEqual([{ ...platform, isCustom: false }]);
    expect(mockCustom).not.toHaveBeenCalled();
    expect(mockMember).toHaveBeenCalledWith({
      where: {
        userId: 'usr_1',
        organizationId: 'org_tenant',
        isActive: true,
        deactivated: false,
        idpAccessRevoked: false,
      },
      select: { id: true },
    });
  });

  it.each(['admin', 'employee'])(
    'includes private frameworks for an active %s member',
    async (role) => {
      mockMember.mockResolvedValue({
        id: 'mem_1',
        role,
        userId: 'usr_1',
        organizationId: 'org_tenant',
        createdAt: timestamps.createdAt,
        roleSource: 'sso',
        idpAccessRevoked: false,
        department: 'none',
        jobTitle: null,
        isActive: true,
        deactivated: false,
        backgroundCheckExempt: false,
        backgroundCheckExemptReason: null,
        backgroundCheckExemptJustification: null,
        onboardDate: null,
        offboardDate: null,
        externalUserId: null,
        externalUserSource: null,
        fleetDmLabelId: null,
      });

      const result = await findAvailableFrameworks(context);

      expect(result).toEqual([
        { ...platform, isCustom: false },
        { ...custom, visible: true, isCustom: true },
      ]);
      expect(mockCustom).toHaveBeenCalledWith({
        where: { organizationId: 'org_tenant' },
        include: { requirements: true },
        orderBy: { name: 'asc' },
      });
    },
  );

  it('keeps the platform catalog available before organization setup', async () => {
    const result = await findAvailableFrameworks({
      ...context,
      organizationId: undefined,
    });

    expect(result).toEqual([{ ...platform, isCustom: false }]);
    expect(mockMember).not.toHaveBeenCalled();
    expect(mockCustom).not.toHaveBeenCalled();
  });

  it('does not query private frameworks for a session without a user', async () => {
    const result = await findAvailableFrameworks({
      ...context,
      userId: undefined,
    });

    expect(result).toEqual([{ ...platform, isCustom: false }]);
    expect(mockMember).not.toHaveBeenCalled();
    expect(mockCustom).not.toHaveBeenCalled();
  });

  it.each(['api-key', 'service'] as const)(
    'preserves organization-scoped %s catalog access',
    async (authType) => {
      const result = await findAvailableFrameworks({
        organizationId: context.organizationId,
        authType,
      });

      expect(result).toHaveLength(2);
      expect(mockMember).not.toHaveBeenCalled();
      expect(mockCustom).toHaveBeenCalled();
    },
  );

  it('does not read private frameworks when membership lookup fails', async () => {
    mockMember.mockRejectedValue(new Error('database unavailable'));

    await expect(findAvailableFrameworks(context)).rejects.toThrow(
      'database unavailable',
    );
    expect(mockCustom).not.toHaveBeenCalled();
  });
});
