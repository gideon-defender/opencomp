import { db } from '@db';
import { filterComplianceMembers } from './compliance-filters';

jest.mock('@db', () => ({
  db: { organizationRole: { findMany: jest.fn() } },
}));

const findRoles = jest.mocked(db.organizationRole.findMany);
const roleRow = ({
  name,
  obligations,
}: {
  name: string;
  obligations: string;
}) => ({
  id: `rol_${name}`,
  name,
  obligations,
  permissions: '{}',
  organizationId: 'org_1',
  createdAt: new Date('2026-10-16'),
  updatedAt: new Date('2026-10-16'),
});

describe('filterComplianceMembers', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    findRoles.mockResolvedValue([]);
  });

  it('honors built-in opt-ins and opt-outs in one tenant-scoped query', async () => {
    const members = [
      { id: 'admin', role: 'admin' },
      { id: 'owner', role: 'owner' },
      { id: 'employee', role: 'employee' },
      { id: 'contractor', role: 'contractor' },
    ];
    findRoles.mockResolvedValue(
      [
        { name: 'admin', obligations: '{"compliance":true}' },
        { name: 'owner', obligations: '{"compliance":false}' },
        { name: 'employee', obligations: '{"compliance":false}' },
        { name: 'contractor', obligations: '{"compliance":false}' },
      ].map(roleRow),
    );

    expect(await filterComplianceMembers(members, 'org_1')).toEqual([
      members[0],
    ]);
    expect(findRoles).toHaveBeenCalledTimes(1);
    expect(findRoles).toHaveBeenCalledWith({
      where: {
        organizationId: 'org_1',
        name: { in: ['admin', 'owner', 'employee', 'contractor'] },
      },
      select: { name: true, obligations: true },
    });
  });

  it('keeps built-in defaults when no override exists', async () => {
    const members = ['owner', 'admin', 'auditor', 'employee', 'contractor'].map(
      (role) => ({ role }),
    );
    expect(await filterComplianceMembers(members, 'org_1')).toEqual([
      members[0],
      members[3],
      members[4],
    ]);
  });

  it.each(['{}', '{"compliance":"false"}', 'invalid JSON', 'null', '[]'])(
    'falls back to built-in defaults for an invalid or absent flag: %s',
    async (obligations) => {
      findRoles.mockResolvedValue([roleRow({ name: 'employee', obligations })]);
      const members = [{ role: 'employee' }];
      expect(await filterComplianceMembers(members, 'org_1')).toEqual(members);
    },
  );

  it('unions exact role tokens and preserves member records', async () => {
    findRoles.mockResolvedValue(
      [
        { name: 'employee', obligations: '{"compliance":false}' },
        { name: 'Lead', obligations: '{"compliance":true}' },
      ].map(roleRow),
    );
    const members = [
      { id: 'included', role: ' employee, Lead,Lead ', name: 'Person' },
      { id: 'excluded', role: 'employee,lead,Compliance Lead' },
    ];
    const result = await filterComplianceMembers(members, 'org_1');
    expect(result).toEqual([members[0]]);
    expect(result[0]).toBe(members[0]);
  });

  it('does not query roles for an empty member list or empty role tokens', async () => {
    expect(await filterComplianceMembers([], 'org_1')).toEqual([]);
    expect(await filterComplianceMembers([{ role: ' , ' }], 'org_1')).toEqual(
      [],
    );
    expect(findRoles).not.toHaveBeenCalled();
  });
});
