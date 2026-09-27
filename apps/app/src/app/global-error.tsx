'use client';

import { Button } from '@gideon-defender/ui/button';
import * as Sentry from '@sentry/nextjs';
import NextError from 'next/error';
import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Why this page stays in English:
 *
 * `global-error.tsx` replaces the entire root layout when it renders, so it
 * mounts *outside* `NextIntlClientProvider` and outside any server-component
 * request config. `useTranslations` / `getTranslations` are unavailable here —
 * calling them throws. Keeping static English copy is intentional; we only
 * make the `<html lang>` attribute locale-aware (read from the `NEXT_LOCALE`
 * cookie set by `i18n/request.ts`) so assistive tech announces correctly.
 */
function useDocumentLocale(): string {
  const [locale, setLocale] = useState('en');

  useEffect(() => {
    // Client-only cookie read after mount; deferred past render to avoid
    // cascading renders.
    queueMicrotask(() => {
      const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=(en|es)/);
      if (match?.[1]) {
        setLocale(match[1]);
      }
    });
  }, []);

  return locale;
}

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  const locale = useDocumentLocale();

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang={locale}>
      <body>
        <div className="h-[calc(100vh-200px)] w-full">
          <div className="flex h-full flex-col items-center justify-center">
            <div className="mt-8 mb-8 flex flex-col items-center justify-between text-center">
              <h2 className="mb-4 font-medium">Something went wrong</h2>
              <p className="text-sm text-[#878787]">
                An unexpected error has occurred. Please try again
                <br /> or contact support if the issue persists.
              </p>
            </div>

            <div className="flex space-x-4">
              <Button onClick={() => reset()} variant="outline">
                Try again
              </Button>

              <Link href="/account/support">
                <Button>Contact us</Button>
              </Link>
            </div>

            <NextError statusCode={0} />
          </div>
        </div>
      </body>
    </html>
  );
}
