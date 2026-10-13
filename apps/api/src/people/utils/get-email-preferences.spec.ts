import { getUserEmailPreferences } from './get-email-preferences';
import { updateUserEmailPreferences } from './update-email-preferences';

const mockRead = jest.fn();
const mockWrite = jest.fn();
jest.mock('@db', () => ({
  db: {
    user: {
      findUnique: (...args: unknown[]) => mockRead(...args),
      update: (...args: unknown[]) => mockWrite(...args),
    },
  },
}));

const legacyPreferences = {
  policyNotifications: true,
  taskReminders: false,
  weeklyTaskDigest: true,
  unassignedItemsNotifications: false,
  taskMentions: true,
  taskAssignments: false,
};

describe('effective email preferences', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the enabled finding default for legacy preferences and saves the displayed choice', async () => {
    mockRead.mockResolvedValue({
      emailPreferences: legacyPreferences,
      emailNotificationsUnsubscribed: false,
    });
    const result = await getUserEmailPreferences({
      userId: 'usr_1',
      userEmail: 'user@example.com',
    });
    expect(result.preferences).toEqual({
      ...legacyPreferences,
      findingNotifications: true,
    });
    await updateUserEmailPreferences({
      userId: 'usr_1',
      preferences: result.preferences,
    });
    expect(mockWrite).toHaveBeenCalledWith({
      where: { id: 'usr_1' },
      data: {
        emailPreferences: result.preferences,
        emailNotificationsUnsubscribed: false,
      },
    });
  });

  it('displays every preference disabled for a global opt-out, even with stale enabled fields', async () => {
    mockRead.mockResolvedValue({
      emailPreferences: legacyPreferences,
      emailNotificationsUnsubscribed: true,
    });
    const result = await getUserEmailPreferences({
      userId: 'usr_1',
      userEmail: 'user@example.com',
    });
    expect(result.unsubscribed).toBe(true);
    expect(Object.values(result.preferences)).toEqual(Array(7).fill(false));
  });

  it('preserves explicit finding opt-outs', async () => {
    mockRead.mockResolvedValue({
      emailPreferences: { findingNotifications: false },
      emailNotificationsUnsubscribed: false,
    });
    const result = await getUserEmailPreferences({
      userId: 'usr_1',
      userEmail: 'user@example.com',
    });
    expect(result.preferences.findingNotifications).toBe(false);
    expect(result.preferences.policyNotifications).toBe(true);
  });

  it('rejects missing users', async () => {
    mockRead.mockResolvedValue(null);
    await expect(
      getUserEmailPreferences({
        userId: 'missing',
        userEmail: 'user@example.com',
      }),
    ).rejects.toThrow('User not found');
  });
});
