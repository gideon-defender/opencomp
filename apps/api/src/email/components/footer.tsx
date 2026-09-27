import { Hr, Link, Section, Text } from '@react-email/components';
import type { EmailLocale } from '../locale';

interface FooterProps {
  locale?: EmailLocale;
}

const copy = {
  en: { tagline: 'AI that handles compliance for you -' },
  es: { tagline: 'IA que gestiona el cumplimiento por ti -' },
};

export function Footer({ locale = 'en' }: FooterProps) {
  const t = copy[locale];
  return (
    <Section className="w-full">
      <Hr />

      <Text className="font-regular text-[14px]">
        {t.tagline}{' '}
        <Link href="https://gideondefender.com?utm_source=email&utm_medium=footer">
          OpenComp
        </Link>
        .
      </Text>

      <Text className="text-xs text-[#B8B8B8]">
        OpenComp | 2261 Market Street, San Francisco, CA 94114
      </Text>
    </Section>
  );
}
