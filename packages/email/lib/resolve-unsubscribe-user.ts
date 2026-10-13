import { normalizeEmail, verifyUserUnsubscribeToken } from './unsubscribe';

export interface UnsubscribeUser {
  id: string;
  email: string;
  emailPreferences?: unknown;
  emailNotificationsUnsubscribed?: boolean;
}

export interface UnsubscribeUserDb {
  user: {
    findUnique: (args: {
      where: { id: string };
      select: {
        id: true;
        email: true;
        emailPreferences: true;
        emailNotificationsUnsubscribed: true;
      };
    }) => Promise<UnsubscribeUser | null>;
    findMany: (args: {
      where: {
        email: { equals: string; mode: 'insensitive' };
        OR?: (
          | { tenantId: string }
          | { members: { some: { organizationId: string; deactivated: false } } }
        )[];
      };
      select: {
        id: true;
        email: true;
        emailPreferences: true;
        emailNotificationsUnsubscribed: true;
      };
    }) => Promise<UnsubscribeUser[]>;
  };
}

const select = {
  id: true,
  email: true,
  emailPreferences: true,
  emailNotificationsUnsubscribed: true,
} as const;

/** Resolve signed tenant scope after a shared user's secondary memberships split. */
export async function resolveUnsubscribeUser(params: {
  db: UnsubscribeUserDb;
  userId: string;
  email: string;
  token: string;
  organizationId?: string;
}): Promise<UnsubscribeUser | null> {
  const { db, userId, organizationId, token } = params;
  const email = normalizeEmail(params.email);
  if (!verifyUserUnsubscribeToken({ userId, organizationId, email, token })) return null;
  if (!organizationId) {
    const original = await db.user.findUnique({ where: { id: userId }, select });
    return original && normalizeEmail(original.email) === email ? original : null;
  }
  const matches = await db.user.findMany({
    where: {
      email: { equals: email, mode: 'insensitive' },
      OR: [
        { tenantId: organizationId },
        { members: { some: { organizationId, deactivated: false } } },
      ],
    },
    select,
  });
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
