import { updateUserEmailPreferences } from './update-email-preferences';

const mockRead = jest.fn();
const mockWrite = jest.fn();
const mockLock = jest.fn();
jest.mock('@db', () => {
  const tx = {
    user: {
      findUnique: (...args: unknown[]) => mockRead(...args),
      update: (...args: unknown[]) => mockWrite(...args),
    },
    $queryRaw: (...args: unknown[]) => mockLock(...args),
  };
  return {
    db: {
      ...tx,
      $transaction: async (run: (client: typeof tx) => Promise<void>) =>
        run(tx),
    },
  };
});
const legacyPreferences = {
  policyNotifications: false,
  taskReminders: false,
  weeklyTaskDigest: false,
  unassignedItemsNotifications: false,
  taskMentions: false,
  taskAssignments: false,
};
describe('legacy email preference updates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWrite.mockResolvedValue({ id: 'usr_1' });
  });
  it.each([true, false])(
    'preserves the saved finding notification choice: %s',
    async (choice) => {
      mockRead.mockResolvedValue({
        emailPreferences: { findingNotifications: choice },
        emailNotificationsUnsubscribed: false,
      });
      await updateUserEmailPreferences({
        userId: 'usr_1',
        preferences: legacyPreferences,
      });
      expect(mockWrite).toHaveBeenCalledWith({
        where: { id: 'usr_1' },
        data: {
          emailPreferences: {
            ...legacyPreferences,
            findingNotifications: choice,
          },
          emailNotificationsUnsubscribed: !choice,
        },
      });
      expect(mockLock).toHaveBeenCalled();
    },
  );
  it.each([true, false])(
    'preserves global opt-out when no finding preference exists: %s',
    async (unsubscribed) => {
      mockRead.mockResolvedValue({
        emailPreferences: {},
        emailNotificationsUnsubscribed: unsubscribed,
      });
      await updateUserEmailPreferences({
        userId: 'usr_1',
        preferences: legacyPreferences,
      });
      expect(mockWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            emailPreferences: {
              ...legacyPreferences,
              findingNotifications: !unsubscribed,
            },
            emailNotificationsUnsubscribed: unsubscribed,
          },
        }),
      );
    },
  );
  it('applies an explicit finding preference', async () => {
    await updateUserEmailPreferences({
      userId: 'usr_1',
      preferences: { ...legacyPreferences, findingNotifications: false },
    });
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          emailPreferences: {
            ...legacyPreferences,
            findingNotifications: false,
          },
          emailNotificationsUnsubscribed: true,
        },
      }),
    );
  });
});
