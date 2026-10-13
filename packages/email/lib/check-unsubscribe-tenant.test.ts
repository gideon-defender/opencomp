import { describe, expect, it, vi } from 'vitest';
import { getUnsubscribedEmails } from './check-unsubscribe';

function mockDb() {
  return {
    user: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    member: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    roleNotificationSetting: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe('getUnsubscribedEmails tenant scoping', () => {
  it('scopes the user lookup by tenant and normalizes mixed-case input', async () => {
    const db = mockDb();
    await getUnsubscribedEmails(
      db,
      ['Person@Example.COM', 'other@example.com'],
      'taskReminders',
      'org_1',
    );
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { tenantId: 'org_1' },
          { members: { some: { organizationId: 'org_1', deactivated: false } } },
        ],
        email: { in: ['person@example.com', 'other@example.com'] },
      },
      select: {
        email: true,
        emailNotificationsUnsubscribed: true,
        emailPreferences: true,
      },
    });
  });

  it('resolves roles within the tenant, never another tenant’s account', async () => {
    const db = mockDb();
    db.user.findMany.mockResolvedValue([
      {
        email: 'person@example.com',
        emailNotificationsUnsubscribed: false,
        emailPreferences: null,
      },
    ]);
    const result = await getUnsubscribedEmails(
      db,
      ['person@example.com'],
      'taskReminders',
      'org_1',
    );
    // Role lookup is scoped to org_1; with no role settings and default
    // preferences the address stays subscribed.
    expect(db.member.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org_1',
        deactivated: false,
        user: { email: { in: ['person@example.com'] } },
      },
      select: { role: true, user: { select: { email: true } } },
    });
    expect(result).toEqual(new Set());
  });
});
