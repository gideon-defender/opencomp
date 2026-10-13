import {
  DEFAULT_PREFERENCES,
  PORTAL_ONLY_DEFAULTS,
  PORTAL_ONLY_ROLES,
  ROLE_SETTING_FIELDS,
  type EmailPreferenceType,
  type RoleNotificationRecord,
} from './email-preference-policy';
import { normalizeEmail } from './unsubscribe';
export { isUserUnsubscribed } from './check-unsubscribe-single';
export type { EmailPreferenceType, RoleNotificationRecord } from './email-preference-policy';

/**
 * Batch version of isUserUnsubscribed.
 *
 * Given a list of email addresses, returns the set of emails that are
 * unsubscribed from the given preferenceType in the given org.
 *
 * Uses 3 DB queries total (regardless of list size) instead of up to 3N.
 * Fail-open: on any error, returns an empty set so all emails are sent.
 *
 * The returned set holds normalized emails (see normalizeEmail). Check
 * membership with a normalized address — a raw mixed-case input never
 * matches, even when that address is unsubscribed.
 */
export async function getUnsubscribedEmails(
  db: {
    user: {
      findMany: (args: {
        where: {
          OR: (
            | { tenantId: string }
            | { members: { some: { organizationId: string; deactivated: false } } }
          )[];
          email: { in: string[] };
        };
        select: {
          email: boolean;
          emailNotificationsUnsubscribed: boolean;
          emailPreferences: boolean;
        };
      }) => Promise<
        Array<{
          email: string;
          emailNotificationsUnsubscribed: boolean;
          emailPreferences: unknown;
        }>
      >;
    };
    member: {
      findMany: (args: {
        where: {
          organizationId: string;
          deactivated: boolean;
          user: { email: { in: string[] } };
        };
        select: { role: boolean; user: { select: { email: boolean } } };
      }) => Promise<Array<{ role: string; user: { email: string } }>>;
    };
    roleNotificationSetting: {
      findMany: (args: {
        where: { organizationId: string };
      }) => Promise<Array<{ role: string } & RoleNotificationRecord>>;
    };
  },
  emails: string[],
  preferenceType: EmailPreferenceType,
  organizationId: string,
): Promise<Set<string>> {
  try {
    if (emails.length === 0) return new Set();

    // Tenant-scoped: only the calling organization's accounts are considered.
    // The same address in another tenant is a separate account with its own
    // preferences and must never suppress this tenant's send. Inputs are
    // normalized first: stored emails are lowercase, and the `in` filter is
    // case-sensitive, so raw mixed-case input would otherwise miss.
    const normalizedEmails = emails.map((e) => normalizeEmail(e));
    const users = await db.user.findMany({
      where: {
        OR: [
          { tenantId: organizationId },
          { members: { some: { organizationId, deactivated: false } } },
        ],
        email: { in: normalizedEmails },
      },
      select: {
        email: true,
        emailNotificationsUnsubscribed: true,
        emailPreferences: true,
      },
    });

    const unsubscribed = new Set<string>();

    // Step 1: filter out legacy all-or-nothing unsubscribes
    const survivingUsers: typeof users = [];
    for (const user of users) {
      if (user.emailNotificationsUnsubscribed) {
        unsubscribed.add(normalizeEmail(user.email));
      } else {
        survivingUsers.push(user);
      }
    }

    if (survivingUsers.length === 0) return unsubscribed;

    const survivingEmails = survivingUsers.map((u) => normalizeEmail(u.email));

    // Step 2: look up org roles for all surviving users in one query
    const memberRecords = await db.member.findMany({
      where: {
        organizationId,
        deactivated: false,
        user: { email: { in: survivingEmails } },
      },
      select: { role: true, user: { select: { email: true } } },
    });

    const rolesByEmail = new Map<string, string[]>();
    for (const m of memberRecords) {
      const key = normalizeEmail(m.user.email);
      const existing = rolesByEmail.get(key) ?? [];
      const roles = m.role.split(',').map((r) => r.trim());
      rolesByEmail.set(key, [...existing, ...roles]);
    }

    // Step 3: fetch all role notification settings for the org in one query
    const allRoleSettings = await db.roleNotificationSetting.findMany({
      where: { organizationId },
    });
    const roleSettingsByRole = new Map<string, RoleNotificationRecord>();
    for (const s of allRoleSettings) {
      roleSettingsByRole.set(s.role, s);
    }

    const roleSettingField = ROLE_SETTING_FIELDS[preferenceType];

    // Step 4: apply the same resolution logic as isUserUnsubscribed per user
    for (const user of survivingUsers) {
      const userRoles = rolesByEmail.get(normalizeEmail(user.email));

      if (roleSettingField && userRoles && userRoles.length > 0) {
        const matchingSettings = userRoles
          .map((r) => roleSettingsByRole.get(r))
          .filter((s): s is RoleNotificationRecord => s !== undefined);

        if (matchingSettings.length > 0) {
          const enabledByRole = matchingSettings.some(
            (s) => s[roleSettingField as keyof RoleNotificationRecord],
          );
          if (!enabledByRole) {
            // All roles say OFF — unsubscribed regardless of personal prefs
            unsubscribed.add(normalizeEmail(user.email));
            continue;
          }
          // Role says ON — fall through to personal preferences
        } else {
          // No DB records — use built-in defaults for portal-only roles
          const allPortalOnly = userRoles.every((r) => PORTAL_ONLY_ROLES.has(r));
          if (allPortalOnly) {
            const enabled = PORTAL_ONLY_DEFAULTS[roleSettingField as keyof RoleNotificationRecord];
            if (!enabled) {
              unsubscribed.add(normalizeEmail(user.email));
              continue;
            }
          }
        }
      }

      // Check personal preference — overrides the role matrix for any user
      const preferences =
        user.emailPreferences && typeof user.emailPreferences === 'object'
          ? {
              ...DEFAULT_PREFERENCES,
              ...(user.emailPreferences as Record<string, boolean>),
            }
          : DEFAULT_PREFERENCES;

      if (preferences[preferenceType] === false) {
        unsubscribed.add(normalizeEmail(user.email));
      }
    }

    return unsubscribed;
  } catch (error) {
    console.error('Error checking unsubscribe status (batch):', error);
    return new Set();
  }
}
