import { MemberQueries } from './member-queries';
import { Prisma } from '@prisma/client';

describe('People directory schema contract', () => {
  it('selects only existing user fields and keeps roles on the tenant membership', () => {
    const userModel = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === 'User',
    );
    expect(userModel).toBeDefined();
    const fields = new Set(userModel?.fields.map((field) => field.name));
    for (const field of Object.keys(MemberQueries.MEMBER_SELECT.user.select)) {
      expect(fields.has(field)).toBe(true);
    }
    expect(MemberQueries.MEMBER_SELECT.role).toBe(true);
  });
});
