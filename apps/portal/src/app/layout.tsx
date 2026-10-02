import { auth } from '@/app/lib/auth';
import { env } from '@/env.mjs';
import { initializeServer } from '@gideon-defender/analytics/server';
import { cn } from '@gideon-defender/ui/cn';
import '@trycompai/design-system/globals.css';
import { GeistMono } from 'geist/font/mono';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import localFont from 'next/font/local';
import { headers } from 'next/headers';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Suspense } from 'react';
import { Toaster } from 'sonner';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  metadataBase: new URL('https://portal.gideondefender.com'),
  title: 'OpenComp | Employee Portal',
  description: 'Enter your email and one time password to continue',
  twitter: {
    title: 'OpenComp | Employee Portal',
    description: 'Enter your email and one time password to continue',
    images: [
      {
        url: 'https://cdn.gideondefender.com/opengraph-image.jpg',
        width: 800,
        height: 600,
      },
      {
        url: 'https://cdn.gideondefender.com/opengraph-image.jpg',
        width: 1800,
        height: 1600,
      },
    ],
  },
  openGraph: {
    title: 'OpenComp | Employee Portal',
    description: 'Enter your email and one time password to continue',
    url: 'https://portal.gideondefender.com',
    siteName: 'OpenComp',
    images: [
      {
        url: 'https://cdn.gideondefender.com/opengraph-image.jpg',
        width: 800,
        height: 600,
      },
      {
        url: 'https://cdn.gideondefender.com/opengraph-image.jpg',
        width: 1800,
        height: 1600,
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)' },
    { media: '(prefers-color-scheme: dark)' },
  ],
};

const font = localFont({
  src: '../../public/fonts/GeneralSans-Variable.ttf',
  display: 'swap',
  variable: '--font-general-sans',
});

if (env.NEXT_PUBLIC_POSTHOG_KEY && env.NEXT_PUBLIC_POSTHOG_HOST) {
  initializeServer({
    apiKey: env.NEXT_PUBLIC_POSTHOG_KEY,
    apiHost: env.NEXT_PUBLIC_POSTHOG_HOST,
  });
}

export default async function Layout(props: { children: React.ReactNode }) {
  const { children } = props;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={cn(
          `${GeistMono.variable} ${font.variable}`,
          'overscroll-none whitespace-pre-line antialiased',
        )}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Suspense>
            <NuqsAdapter>
              <Providers session={session}>
                <main>{children}</main>
              </Providers>
            </NuqsAdapter>
          </Suspense>
        </NextIntlClientProvider>
        <Toaster richColors />
      </body>
    </html>
  );
}
