import { CheckoutCompleteDialog } from '@/components/dialogs/checkout-complete-dialog';
import { MinimalHeader } from '@/components/layout/MinimalHeader';
import { auth } from '@/utils/auth';
import { db } from '@db/server';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { OnboardingSidebar } from '../../setup/components/OnboardingSidebar';

interface OnboardingRouteLayoutProps {
  children: React.ReactNode;
  params: Promise<{ orgId: string }>;
}

export default async function OnboardingRouteLayout({
  children,
  params,
}: OnboardingRouteLayoutProps) {
  const { orgId } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    notFound();
  }

  // Single-tenant: verify membership directly instead of listing all
  // organizations via the /v1/auth/me endpoint. Mirrors the /v1/auth/me
  // filters — only active, non-deactivated memberships may proceed.
  const member = await db.member.findFirst({
    where: {
      userId: session.user.id,
      organizationId: orgId,
      deactivated: false,
      isActive: true,
    },
  });

  if (!member) {
    notFound();
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col">
          <MinimalHeader user={session.user} variant="onboarding" />
          {children}
        </div>

        <div className="hidden md:flex md:w-1/2 min-h-screen bg-[#FAFAFA] items-end justify-center py-16 px-8">
          <OnboardingSidebar className="w-full max-w-xl mx-auto h-1/2 mt-auto" />
        </div>
      </div>
      <CheckoutCompleteDialog orgId={orgId} />
    </main>
  );
}
