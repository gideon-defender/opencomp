import { MinimalHeader } from '@/components/layout/MinimalHeader';
import { auth } from '@/utils/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function UpgradeLayout({ children }: { children: React.ReactNode }) {
  // Check auth
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    redirect('/sign-in');
  }

  const user = session.user;

  return (
    <div className="min-h-dvh">
      <MinimalHeader user={user} variant="upgrade" />

      {/* Main content */}
      <main>{children}</main>
    </div>
  );
}
