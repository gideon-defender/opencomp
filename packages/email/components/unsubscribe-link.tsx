import { Link, Section, Text } from '@react-email/components';
import type { Locale } from '../lib/locale';

interface UnsubscribeLinkProps {
  email: string;
  unsubscribeUrl: string;
  locale?: Locale;
}

const copy: Record<Locale, { prefix: string; link: string }> = {
  en: {
    prefix: 'If you no longer wish to receive these notifications, you can',
    link: 'unsubscribe here',
  },
  es: {
    prefix: 'Si ya no deseas recibir estas notificaciones, puedes',
    link: 'darte de baja aquí',
  },
};

export function UnsubscribeLink({ email, unsubscribeUrl, locale = 'en' }: UnsubscribeLinkProps) {
  const t = copy[locale];
  void email;
  return (
    <Section className="mt-[24px]">
      <Text className="text-[12px] leading-[18px] text-[#999999]">
        {t.prefix}{' '}
        <Link href={unsubscribeUrl} className="text-[#999999] underline">
          {t.link}
        </Link>
        .
      </Text>
    </Section>
  );
}
