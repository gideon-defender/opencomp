import { AuthErrorNotice } from '@gideon-defender/ui/auth-error-notice';
import { LoginForm } from '@/components/login-form';
import { auth } from '@/utils/auth';
import { getSafeRedirectPath } from '@/utils/auth-callback';
import { BrandLogo } from '@gideon-defender/ui/brand-logo';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@gideon-defender/ui/card';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('pageTitle') };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    inviteCode?: string;
    redirectTo?: string;
    error?: string;
  }>;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  const { inviteCode, redirectTo, error } = await searchParams;
  const safeRedirectTo = getSafeRedirectPath(redirectTo);

  const orgId = session?.session?.activeOrganizationId;

  if (orgId && inviteCode) {
    // An invite code always takes priority: send the user to the invitation
    // acceptance flow (which validates the invite and applies the role), never
    // to the new-org onboarding wizard.
    redirect(`/invite/${inviteCode}`);
  }

  if (orgId && !inviteCode) {
    redirect('/');
  }

  const t = await getTranslations('auth');

  // Pre-session login failures redirect here with ?error=<code> (IdP deny
  // lands as no_role). Unknown codes fall back to the generic message.
  const authError =
    typeof error === 'string' && error
      ? {
          title: t('loginFailedTitle'),
          description:
            error === 'no_role'
              ? t('noAccessDescription')
              : t('loginFailedDescription'),
        }
      : null;

  return (
    <div className="flex min-h-dvh flex-col text-foreground">
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center space-y-3 pt-10">
            <div className="mx-auto">
              <BrandLogo iconSize={40} />
            </div>
            <CardTitle className="text-2xl tracking-tight text-card-foreground">
              {t('heroTitle')}
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground px-4">
              {t('heroTagline')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pb-6 px-8">
            {authError && (
              <AuthErrorNotice
                title={authError.title}
                description={authError.description}
              />
            )}
            <LoginForm inviteCode={inviteCode} redirectTo={safeRedirectTo} />
          </CardContent>
          <CardFooter className="pb-10">
            <p className="w-full px-6 text-center text-xs text-muted-foreground">
              {t.rich('termsAgreement', {
                terms: (chunk) => (
                  <Link
                    href="https://gideondefender.com/terms-and-conditions"
                    className="underline hover:text-primary"
                  >
                    {chunk}
                  </Link>
                ),
                privacy: (chunk) => (
                  <Link
                    href="https://gideondefender.com/privacy-policy"
                    className="underline hover:text-primary"
                  >
                    {chunk}
                  </Link>
                ),
              })}
            </p>
          </CardFooter>
        </Card>
      </main>
    </div>
  );
}
