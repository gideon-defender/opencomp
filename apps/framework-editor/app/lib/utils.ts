import { headers } from 'next/headers';
import { auth } from './auth';

const ALLOWED_DOMAIN = 'gideondefender.com';

export function isInternalUser(email: string): boolean {
  const normalized = email.toLowerCase().trim();
  const parts = normalized.split('@');
  return parts.length === 2 && parts[1] === ALLOWED_DOMAIN;
}

export async function isAuthorized(): Promise<boolean> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) return false;
  if (!session.user.emailVerified) return false;

  // Platform-admin roles were removed with cross-tenant auth: the API no
  // longer returns `user.role`, so the gate is the verified staff email
  // domain. emailVerified is load-bearing — without it any session with a
  // spoofed address passes.
  return isInternalUser(session.user.email);
}
