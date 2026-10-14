import {
  DEFAULT_PREFERENCES,
  PORTAL_ONLY_DEFAULTS,
  PORTAL_ONLY_ROLES,
  ROLE_SETTING_FIELDS,
  type EmailPreferenceType,
  type RoleNotificationRecord,
} from './email-preference-policy';
import { normalizeEmail } from './unsubscribe';
/**
 * Check if a user is unsubscribed from a specific type of email notification.
 *
 * Resolution order (when organizationId is provided):
 * 1. Legacy all-or-nothing flag — if set, user is unsubscribed from everything.
 * 2. Check role notification settings for the user's roles in the org.
 *    - If ALL roles disable this notification, the user is unsubscribed (no override).
 *    - If ANY role enables it, fall through to personal preferences.
 *    - If no role settings are configured, portal-only roles (employee/contractor)
 *      use built-in defaults; other roles fall through to personal preferences.
 * 3. Check personal preferences — any user who previously opted out stays opted out.
 *    Owners/admins can toggle freely; non-admin users see these as read-only in the UI
 *    but their existing opt-outs are still honored so we don't re-subscribe people.
 *
 * Without organizationId: falls back to legacy personal preference behavior.
 */
export async function isUserUnsubscribed(
  db: {
    user: {
      findUnique: (args: {
        where: { tenantId_email: { tenantId: string; email: string } };
        select: {
          emailNotificationsUnsubscribed: boolean;
          emailPreferences: boolean;
        };
      }) => Promise<{
        emailNotificationsUnsubscribed: boolean;
        emailPreferences: unknown;
      } | null>;
      findMany?: (args: {
        where: {
          email: { equals: string; mode: 'insensitive' };
          members?: { some: { organizationId: string; deactivated: false } };
        };
        select: {
          emailNotificationsUnsubscribed: boolean;
          emailPreferences: boolean;
        };
      }) => Promise<
        Array<{
          emailNotificationsUnsubscribed: boolean;
          emailPreferences: unknown;
        }>
      >;
    };
    member?: {
      findMany: (args: {
        where: {
          organizationId: string;
          user: { email: string };
          deactivated: boolean;
        };
        select: { role: boolean };
      }) => Promise<{ role: string }[]>;
    };
    roleNotificationSetting?: {
      findMany: (args: {
        where: { organizationId: string; role: { in: string[] } };
      }) => Promise<RoleNotificationRecord[]>;
    };
  },
  email: string,
  preferenceType?: EmailPreferenceType,
  organizationId?: string,
): Promise<boolean> {
  try {
    const normalized = normalizeEmail(email);
    // Tenant-scoped resolution via the composite (tenantId, email) key, so
    // another tenant's same-email account can never satisfy this tenant's
    // check. Callers without org context cannot resolve unambiguously: with
    // zero or several accounts sharing the address we fail open (send),
    // preserving the old single-account behavior only when exactly one row
    // matches.
    let user = organizationId
      ? await db.user.findUnique({
          where: { tenantId_email: { tenantId: organizationId, email: normalized } },
          select: { emailNotificationsUnsubscribed: true, emailPreferences: true },
        })
      : null;
    if (!user && db.user.findMany) {
      const matches = await db.user.findMany({
        where: {
          email: { equals: normalized, mode: 'insensitive' },
          ...(organizationId
            ? { members: { some: { organizationId, deactivated: false as const } } }
            : {}),
        },
        select: { emailNotificationsUnsubscribed: true, emailPreferences: true },
      });
      user = matches.length === 1 ? (matches[0] ?? null) : null;
    }

    if (!user) {
      return false;
    }

    // If legacy all-or-nothing flag is set, user is unsubscribed from everything
    if (user.emailNotificationsUnsubscribed) {
      return true;
    }

    // If no preference type specified, check the legacy flag only
    if (!preferenceType) {
      return user.emailNotificationsUnsubscribed ?? false;
    }

    // Check role-based notification settings if organizationId is provided
    const roleSettingField = ROLE_SETTING_FIELDS[preferenceType];
    if (organizationId && roleSettingField && db.member && db.roleNotificationSetting) {
      // Look up the user's roles in this organization (normalized: the
      // member email filter is case-sensitive while callers pass raw input).
      const memberRecords = await db.member.findMany({
        where: {
          organizationId,
          user: { email: normalized },
          deactivated: false,
        },
        select: { role: true },
      });

      if (memberRecords.length > 0) {
        // Roles can be comma-separated (e.g., "admin,auditor")
        const userRoles = memberRecords.flatMap((m) => m.role.split(',').map((r) => r.trim()));

        const roleSettings = await db.roleNotificationSetting.findMany({
          where: {
            organizationId,
            role: { in: userRoles },
          },
        });

        if (roleSettings.length > 0) {
          // Union: if ANY role enables this notification, it's ON
          const enabledByRole = roleSettings.some(
            (s) => s[roleSettingField as keyof RoleNotificationRecord],
          );

          if (!enabledByRole) {
            // All roles say OFF — user is unsubscribed regardless
            return true;
          }

          // Role says ON — fall through to personal preferences.
          // This ensures users who previously opted out stay opted out,
          // even if their role matrix now enables the notification.
        } else {
          // No DB records — use built-in defaults for portal-only roles
          const allPortalOnly = userRoles.every((r) => PORTAL_ONLY_ROLES.has(r));
          if (allPortalOnly) {
            const enabled = PORTAL_ONLY_DEFAULTS[roleSettingField as keyof RoleNotificationRecord];
            if (!enabled) {
              return true;
            }
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

    return preferences[preferenceType] === false;
  } catch (error) {
    console.error('Error checking unsubscribe status:', error);
    return false;
  }
}
