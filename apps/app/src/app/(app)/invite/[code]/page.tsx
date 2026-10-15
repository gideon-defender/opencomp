import { OnboardingLayout } from '@/components/onboarding/OnboardingLayout';
import { auth } from '@/utils/auth';
import { db } from '@db/server';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { InviteStatusCard } from './components/InviteStatusCard';

interface InvitePageProps {
  params: Promise<{ code: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { code } = await params;
  const t = await getTranslations('invite');
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return redirect(`/auth?inviteCode=${code}`);
  }

  const invitation = await db.invitation.findFirst({
    where: {
      id: code,
    },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!invitation) {
    return (
      <OnboardingLayout variant="setup" currentOrganization={null}>
        <div className="flex min-h-[calc(100dvh-80px)] w-full items-center justify-center p-4">
          <InviteStatusCard
            title={t('inviteNotFound')}
            description={t('inviteNotFoundDescription')}
            primaryHref="/"
            primaryLabel={t('goHome')}
          />
        </div>
      </OnboardingLayout>
    );
  }

  if (invitation.status !== 'pending') {
    // Check if the current user is a member of this organization
    // If so, this means they just accepted the invite and we should redirect them
    const membership = await db.member.findFirst({
      where: {
        userId: session.user.id,
        organizationId: invitation.organizationId,
        deactivated: false,
      },
    });

    if (membership) {
      // User is a member - redirect to the organization
      return redirect(`/${invitation.organizationId}`);
    }

    // User is not a member - show the appropriate message
    return (
      <OnboardingLayout variant="setup" currentOrganization={null}>
        <div className="flex min-h-[calc(100dvh-80px)] w-full items-center justify-center p-4">
          <InviteStatusCard
            title={
              invitation.status === 'accepted' ? t('inviteAlreadyAccepted') : t('inviteExpired')
            }
            description={
              invitation.status === 'accepted'
                ? t('inviteAlreadyAcceptedDescription')
                : t('inviteExpiredDescription')
            }
            primaryHref="/"
            primaryLabel={t('goHome')}
          />
        </div>
      </OnboardingLayout>
    );
  }

  // Invitation acceptance is retired: access is granted in Gideon, never
  // through an invite link. Every pending link renders the retired notice,
  // regardless of which signed-in user opens it, so the page never reveals
  // the invited email.
  return (
    <OnboardingLayout variant="setup" currentOrganization={null}>
      <div className="flex min-h-[calc(100dvh-80px)] w-full items-center justify-center p-4">
        <InviteStatusCard
          title={t('inviteRetired')}
          description={t('inviteRetiredDescription')}
          primaryHref="/"
          primaryLabel={t('goHome')}
        />
      </div>
    </OnboardingLayout>
  );
}
