import { db, normalizeEmail } from '@db/server';
import { resolveUnsubscribeUser, verifyUnsubscribeToken } from '@gideon-defender/email';
import { UnsubscribePreferencesClient, type EmailPreferences } from './client';

interface PageProps {
  searchParams: Promise<{
    email?: string | string[];
    token?: string | string[];
    userId?: string | string[];
    organizationId?: string | string[];
  }>;
}

const DEFAULT_PREFERENCES: EmailPreferences = {
  policyNotifications: true,
  taskReminders: true,
  weeklyTaskDigest: true,
  unassignedItemsNotifications: true,
  taskMentions: true,
  taskAssignments: true,
  findingNotifications: true,
};

async function fetchUserPreferences({
  email,
  token,
  userId,
  organizationId,
}: {
  email: string;
  token: string;
  userId?: string;
  organizationId?: string;
}): Promise<{ error: string } | { preferences: EmailPreferences }> {
  const normalizedEmail = normalizeEmail(email);

  if (userId) {
    const scoped = await resolveUnsubscribeUser({
      db,
      userId,
      email: normalizedEmail,
      token,
      organizationId,
    });
    if (!scoped) return { error: 'Invalid token' };
    if (scoped.emailNotificationsUnsubscribed) {
      return {
        preferences: {
          policyNotifications: false,
          taskReminders: false,
          weeklyTaskDigest: false,
          unassignedItemsNotifications: false,
          taskMentions: false,
          taskAssignments: false,
          findingNotifications: false,
        },
      };
    }
    const preferences =
      scoped.emailPreferences && typeof scoped.emailPreferences === 'object'
        ? { ...DEFAULT_PREFERENCES, ...(scoped.emailPreferences as Record<string, boolean>) }
        : DEFAULT_PREFERENCES;
    return { preferences };
  }

  // Pass the raw address: the verifier also accepts the pre-scoping
  // (raw) token form so in-flight links keep working.
  if (!verifyUnsubscribeToken(email, token)) {
    return { error: 'Invalid token' };
  }

  const matches = await db.user.findMany({
    where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    select: { id: true, emailPreferences: true, emailNotificationsUnsubscribed: true },
  });

  if (matches.length === 0) {
    return { error: 'User not found' };
  }
  if (matches.length > 1) {
    return {
      error: 'This email is used by several organizations — use your organization-specific link',
    };
  }
  const user = matches[0];

  // If user has the old all-or-nothing unsubscribe flag, convert to preferences
  if (user.emailNotificationsUnsubscribed) {
    return {
      preferences: {
        policyNotifications: false,
        taskReminders: false,
        weeklyTaskDigest: false,
        unassignedItemsNotifications: false,
        taskMentions: false,
        taskAssignments: false,
        findingNotifications: false,
      },
    };
  }

  // Return preferences or defaults
  const preferences =
    user.emailPreferences && typeof user.emailPreferences === 'object'
      ? { ...DEFAULT_PREFERENCES, ...(user.emailPreferences as Record<string, boolean>) }
      : DEFAULT_PREFERENCES;

  return { preferences };
}

export default async function UnsubscribePreferencesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  // Coerce to string — query params can be arrays when repeated.
  const email = typeof params.email === 'string' ? params.email : undefined;
  const token = typeof params.token === 'string' ? params.token : undefined;
  const userId = typeof params.userId === 'string' ? params.userId : undefined;
  const organizationId =
    typeof params.organizationId === 'string' ? params.organizationId : undefined;

  if (!email || !token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
          <div className="text-center text-red-600">Email and token are required</div>
        </div>
      </div>
    );
  }

  const result = await fetchUserPreferences({ email, token, userId, organizationId });

  if ('error' in result) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
          <div className="text-center text-red-600">{result.error}</div>
        </div>
      </div>
    );
  }

  return (
    <UnsubscribePreferencesClient
      email={email}
      token={token}
      userId={userId}
      organizationId={organizationId}
      initialPreferences={result.preferences}
    />
  );
}
