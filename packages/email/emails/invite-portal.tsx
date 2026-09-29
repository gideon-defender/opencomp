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
import type { Locale } from '../lib/locale';

interface Props {
  email: string;
  inviteLink: string;
  organizationName?: string;
  locale?: Locale;
}

const copy: Record<
  Locale,
  {
    preview: string;
    heading: string;
    withOrg: string;
    withoutOrg: string;
    button: string;
    copyPaste: string;
    footer: string;
  }
> = {
  en: {
    preview: "You've been invited to the OpenComp Portal",
    heading: "You've been invited to the OpenComp Portal",
    withOrg: 'has invited you to access their OpenComp Portal.',
    withoutOrg: "You've been invited to access the OpenComp Portal.",
    button: 'Accept Invitation',
    copyPaste: 'or copy and paste this URL into your browser',
    footer: 'This invitation was intended for',
  },
  es: {
    preview: 'Te han invitado al Portal de OpenComp',
    heading: 'Te han invitado al Portal de OpenComp',
    withOrg: 'te ha invitado a acceder a su Portal de OpenComp.',
    withoutOrg: 'Te han invitado a acceder al Portal de OpenComp.',
    button: 'Aceptar invitación',
    copyPaste: 'o copia y pega esta URL en tu navegador',
    footer: 'Esta invitación estaba destinada a',
  },
};

export const InvitePortalEmail = ({ email, inviteLink, organizationName, locale = 'en' }: Props) => {
  const t = copy[locale];
  return (
    <Html lang={locale}>
      <Tailwind>
        <head />
        <Preview>{t.preview}</Preview>

        <Body className="mx-auto my-auto bg-[#fff] font-sans">
          <Container
            className="mx-auto my-[40px] max-w-[600px] border-transparent p-[20px] md:border-[#E8E7E1]"
            style={{ borderStyle: 'solid', borderWidth: 1 }}
          >
            <Logo />
            <Heading className="mx-0 my-[30px] p-0 text-center text-[24px] font-normal text-[#121212]">
              {t.heading}
            </Heading>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {organizationName ? `${organizationName} ${t.withOrg}` : t.withoutOrg}
            </Text>
            <Section className="mt-[32px] mb-[42px] text-center">
              <Button
                className="text-primary border border-solid border-[#121212] bg-transparent px-6 py-3 text-center text-[14px] font-medium text-[#121212] no-underline"
                href={inviteLink}
              >
                {t.button}
              </Button>
            </Section>

            <Text className="text-[14px] leading-[24px] break-all text-[#707070]">
              {t.copyPaste}{' '}
              <Link href={inviteLink} className="text-[#707070] underline">
                {inviteLink}
              </Link>
            </Text>

            <br />
            <Section>
              <Text className="text-[12px] leading-[24px] text-[#666666]">
                {t.footer} <span className="text-[#121212]">{email}</span>.{' '}
              </Text>
            </Section>

            <br />

            <Footer locale={locale} />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default InvitePortalEmail;
