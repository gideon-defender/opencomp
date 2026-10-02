import { Hr, Link, Section, Text } from '@react-email/components';
import type { Locale } from '../lib/locale';

const copy: Record<Locale, { tagline: string }> = {
  en: { tagline: 'AI that handles compliance for you' },
  es: { tagline: 'IA que gestiona el cumplimiento por ti' },
};

export function Footer({ locale = 'en' }: { locale?: Locale }) {
  const t = copy[locale];
  return (
    <Section className="w-full">
      <Hr />

      <Text className="font-regular text-[14px]">
        {t.tagline} -{' '}
        <Link href="https://gideondefender.com?utm_source=email&utm_medium=footer">OpenComp</Link>.
      </Text>

      <Text className="text-xs text-[#B8B8B8]">
        Gideon Defender, Inc. | 2621 NE 212th Terrace Unit 209, Miami, FL 33180
      </Text>
    </Section>
  );
}
