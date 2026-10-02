'use client';

import * as Sentry from '@sentry/nextjs';
import { useLocale, useTranslations } from 'next-intl';
import NextError from 'next/error';
import { useEffect } from 'react';

export default function GlobalError({ error }: { error: Error }) {
  const t = useTranslations('errors');
  const locale = useLocale();

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang={locale}>
      <body>
        <NextError statusCode={0} title={t('somethingWrong')} />
      </body>
    </html>
  );
}
