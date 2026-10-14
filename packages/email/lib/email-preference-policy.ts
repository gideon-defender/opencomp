export const DEFAULT_PREFERENCES = {
  policyNotifications: true,
  taskReminders: true,
  weeklyTaskDigest: true,
  unassignedItemsNotifications: true,
  taskMentions: true,
  taskAssignments: true,
  findingNotifications: true,
};

export type EmailPreferenceType =
  | 'policyNotifications'
  | 'taskReminders'
  | 'weeklyTaskDigest'
  | 'unassignedItemsNotifications'
  | 'taskMentions'
  | 'taskAssignments'
  | 'findingNotifications';

export function resolveEmailPreferences({
  preferences,
  unsubscribed = false,
}: {
  preferences: unknown;
  unsubscribed?: boolean;
}): Record<EmailPreferenceType, boolean> {
  const stored = new Map<string, unknown>(
    preferences && typeof preferences === 'object' && !Array.isArray(preferences)
      ? Object.entries(preferences)
      : [],
  );
  const read = (key: EmailPreferenceType): boolean => {
    if (unsubscribed) return false;
    const value = stored.get(key);
    return typeof value === 'boolean' ? value : DEFAULT_PREFERENCES[key];
  };
  return {
    policyNotifications: read('policyNotifications'),
    taskReminders: read('taskReminders'),
    weeklyTaskDigest: read('weeklyTaskDigest'),
    unassignedItemsNotifications: read('unassignedItemsNotifications'),
    taskMentions: read('taskMentions'),
    taskAssignments: read('taskAssignments'),
    findingNotifications: read('findingNotifications'),
  };
}

// Maps EmailPreferenceType to RoleNotificationSetting field names
export const ROLE_SETTING_FIELDS: Partial<Record<EmailPreferenceType, string>> = {
  policyNotifications: 'policyNotifications',
  taskReminders: 'taskReminders',
  taskAssignments: 'taskAssignments',
  taskMentions: 'taskMentions',
  weeklyTaskDigest: 'weeklyTaskDigest',
  findingNotifications: 'findingNotifications',
  // unassignedItemsNotifications has no role-level setting
};

// Portal-only roles should not receive app notifications by default.
// When no role_notification_setting DB record exists, these defaults apply.
export const PORTAL_ONLY_ROLES = new Set(['employee', 'contractor']);
export const PORTAL_ONLY_DEFAULTS: RoleNotificationRecord = {
  policyNotifications: true,
  taskReminders: false,
  taskAssignments: false,
  taskMentions: false,
  weeklyTaskDigest: false,
  findingNotifications: false,
};

export interface RoleNotificationRecord {
  policyNotifications: boolean;
  taskReminders: boolean;
  taskAssignments: boolean;
  taskMentions: boolean;
  weeklyTaskDigest: boolean;
  findingNotifications: boolean;
}
