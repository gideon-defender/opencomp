import {
  Body,
  Button,
  Container,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
} from '@react-email/components';
import { Footer } from '../components/footer';
import { Logo } from '../components/logo';
import { UnsubscribeLink } from '../components/unsubscribe-link';
import type { Locale } from '../lib/locale';
import { getUnsubscribeUrl } from '../lib/unsubscribe';

interface Props {
  email: string;
  userName: string;
  organizationName: string;
  organizationId: string;
  locale?: Locale;
}

const copy: Record<
  Locale,
  {
    subject: string;
    greeting: string;
    published: string;
    requires: string;
    button: string;
    copyPaste: string;
    footer: string;
  }
> = {
  en: {
    subject: 'Please review and accept the policies',
    greeting: 'Hi',
    published: 'All policies have been published and require your review.',
    requires: 'requires all employees to review and accept these policies.',
    button: 'Review & Accept Policies',
    copyPaste: 'or copy and paste this URL into your browser',
    footer: 'This notification was intended for',
  },
  es: {
    subject: 'Revisa y acepta las políticas',
    greeting: 'Hola',
    published: 'Todas las políticas han sido publicadas y requieren tu revisión.',
    requires: 'requiere que todos los empleados revisen y acepten estas políticas.',
    button: 'Revisar y aceptar las políticas',
    copyPaste: 'o copia y pega esta URL en tu navegador',
    footer: 'Esta notificación estaba destinada a',
  },
};

export const AllPolicyNotificationEmail = ({
  email,
  userName,
  organizationName,
  organizationId,
  locale = 'en',
}: Props) => {
  const t = copy[locale];
  const link = `${process.env.NEXT_PUBLIC_PORTAL_URL ?? 'https://portal.gideondefender.com'}/${organizationId}`;

  return (
    <Html lang={locale}>
      <Tailwind>
        <head />
        <Preview>{t.subject}</Preview>

        <Body className="mx-auto my-auto bg-[#fff] font-sans">
          <Container
            className="mx-auto my-[40px] max-w-[600px] border-transparent p-[20px] md:border-[#E8E7E1]"
            style={{ borderStyle: 'solid', borderWidth: 1 }}
          >
            <Logo />
            <Heading className="mx-0 my-[30px] p-0 text-center text-[24px] font-normal text-[#121212]">
              {t.subject}
            </Heading>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.greeting} {userName},
            </Text>

            <Text className="text-[14px] leading-[24px] text-[#121212]">{t.published}</Text>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {locale === 'es' ? (
                <>
                  Tu organización <strong>{organizationName}</strong> {t.requires}
                </>
              ) : (
                <>
                  Your organization <strong>{organizationName}</strong> {t.requires}
                </>
              )}
            </Text>

            <Section className="mt-[32px] mb-[42px] text-center">
              <Button
                className="text-primary border border-solid border-[#121212] bg-transparent px-6 py-3 text-center text-[14px] font-medium text-[#121212] no-underline"
                href={link}
              >
                {t.button}
              </Button>
            </Section>

            <Text className="text-[14px] leading-[24px] break-all text-[#707070]">
              {t.copyPaste}{' '}
              <Link href={link} className="text-[#707070] underline">
                {link}
              </Link>
            </Text>

            <br />
            <Section>
              <Text className="text-[12px] leading-[24px] text-[#666666]">
                {t.footer} <span className="text-[#121212]">{email}</span>.
              </Text>
            </Section>

            <UnsubscribeLink
              email={email}
              unsubscribeUrl={getUnsubscribeUrl(email)}
              locale={locale}
            />

            <br />

            <Footer locale={locale} />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default AllPolicyNotificationEmail;
