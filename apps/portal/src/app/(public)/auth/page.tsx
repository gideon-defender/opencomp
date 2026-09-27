import { LoginForm } from '@/app/components/login-form';
import { OtpSignIn } from '@/app/components/otp';
import { BrandLogo } from '@gideon-defender/ui/brand-logo';
import { Button } from '@gideon-defender/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@gideon-defender/ui/card';
import { ArrowRight } from '@trycompai/design-system/icons';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return {
    title: t('pageTitle'),
  };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('auth');
  const params = await searchParams;
  const isDeviceAuth = params.device_auth === 'true';
  const callbackPort = typeof params.callback_port === 'string' ? params.callback_port : undefined;
  const state = typeof params.state === 'string' ? params.state : undefined;

  const deviceAuthRedirect =
    isDeviceAuth && callbackPort && state
      ? `/auth/device-callback?callback_port=${encodeURIComponent(callbackPort)}&state=${encodeURIComponent(state)}`
      : undefined;

  // Milestone 3 — Gideon is the default authenticator. Legacy entry points
  // (email OTP, Google/Microsoft social) render only behind the kill-switch.
  const legacyAuthEnabled = process.env.NEXT_PUBLIC_LEGACY_AUTH_ENABLED === 'true';

  const defaultSignInOptions = legacyAuthEnabled ? (
    <div className="flex flex-col space-y-2">
      <OtpSignIn deviceAuthRedirect={deviceAuthRedirect} />
    </div>
  ) : null;

  // Social providers are configured on the NestJS API.
  // Use optional env vars to explicitly disable them on the portal if needed.
  const showGoogle = legacyAuthEnabled && process.env.PORTAL_DISABLE_GOOGLE_SIGN_IN !== 'true';
  const showMicrosoft =
    legacyAuthEnabled && process.env.PORTAL_DISABLE_MICROSOFT_SIGN_IN !== 'true';

  return (
    <div className="flex min-h-dvh flex-col text-foreground">
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center space-y-3 pt-10">
            <div className="mx-auto">
              <BrandLogo iconSize={40} />
            </div>
            <CardTitle className="text-2xl tracking-tight text-card-foreground">
              {t('portalTitle')}
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground px-4">
              {legacyAuthEnabled ? t('otpDescription') : t('gideonDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pb-6">
            {defaultSignInOptions}
            <LoginForm showGoogle={showGoogle} showMicrosoft={showMicrosoft} />
          </CardContent>
          <CardFooter className="pb-10">
            <div className="from-primary/10 via-primary/5 to-primary/5 rounded-sm bg-gradient-to-r p-4">
              <h3 className="text-sm font-medium">{t('promoTitle')}</h3>
              <p className="text-muted-foreground mt-1 text-xs">{t('promoBody')}</p>
              <Button variant="link" className="mt-2 p-0" asChild>
                <Link
                  href="https://gideondefender.com"
                  target="_blank"
                  className="hover:underline hover:underline-offset-2"
                >
                  <span className="text-primary mt-2 inline-flex items-center gap-2 text-xs font-medium">
                    {t('learnMore')}
                    <ArrowRight className="h-3 w-3" />
                  </span>
                </Link>
              </Button>
            </div>
          </CardFooter>
        </Card>
      </main>
    </div>
  );
}
