import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { enMessages, esMessages, type AppLocale } from '../../i18n/messages';

const messagesByLocale: Record<AppLocale, typeof enMessages> = {
  en: enMessages,
  es: esMessages,
};

export function renderWithIntl(
  ui: ReactElement,
  locale: AppLocale = 'en',
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  return render(
    <NextIntlClientProvider locale={locale} messages={messagesByLocale[locale]}>
      {ui}
    </NextIntlClientProvider>,
    options,
  );
}
