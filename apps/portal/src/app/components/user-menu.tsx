import { auth } from '@/app/lib/auth';
import { getInitials } from '@gideon-defender/utils/format';
import { headers } from 'next/headers';
import { UserMenuClient } from './user-menu-client';

export async function UserMenu() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return null;
  }

  const user = session.user;
  const userInitials = getInitials(user.name ?? user.email ?? '');

  return (
    <UserMenuClient
      name={user.name}
      email={user.email}
      image={user.image ?? null}
      userInitials={userInitials}
    />
  );
}
