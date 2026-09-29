import * as React from 'react';
import { Link, Section, Text } from '@react-email/components';
import { getUnsubscribeUrl } from '@gideon-defender/email';
import type { EmailLocale } from '../locale';

interface Props {
  email: string;
  /**
   * Optional custom message prefix. Defaults to a localized generic
   * notifications text to cover all API email types with a single component.
   */
  message?: string;
  locale?: EmailLocale;
}

const copy = {
  en: {
    defaultMessage: "Don't want to receive these notifications?",
    managePrefs: 'Manage your email preferences',
  },
  es: {
    defaultMessage: '¿No quieres recibir estas notificaciones?',
    managePrefs: 'Gestionar tus preferencias de correo electrónico',
  },
};

export function UnsubscribeFooter({
  email,
  message,
  locale = 'en',
}: Props) {
  const t = copy[locale];
  const url = getUnsubscribeUrl(email);
  return (
    <Section className="mt-[30px] mb-[20px]">
      <Text className="text-[12px] leading-[20px] text-[#666666]">
        {message ?? t.defaultMessage}{' '}
        <Link href={url} className="text-[#121212] underline">
          {t.managePrefs}
        </Link>
        .
      </Text>
    </Section>
  );
}
