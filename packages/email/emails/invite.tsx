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
  email?: string;
  organizationName: string;
  inviteLink: string;
  locale?: Locale;
}

const copy: Record<
  Locale,
  { preview: string; body: string; button: string; copyPaste: string; intendedFor: string }
> = {
  en: {
    preview: "You've been invited to join OpenComp",
    body: "You've been invited to join your team on",
    button: 'Get started',
    copyPaste: 'or copy and paste this URL into your browser',
    intendedFor: 'this invitation was intended for',
  },
  es: {
    preview: 'Te han invitado a unirte a OpenComp',
    body: 'Te han invitado a unirte a tu equipo en',
    button: 'Comenzar',
    copyPaste: 'o copia y pega esta URL en tu navegador',
    intendedFor: 'esta invitación estaba destinada a',
  },
};

export const InviteEmail = ({ email, organizationName, inviteLink, locale = 'en' }: Props) => {
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
              Join <strong>{organizationName}</strong> on <strong>OpenComp</strong>
            </Heading>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.body} <strong>OpenComp</strong>.
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
                {t.intendedFor} <span className="text-[#121212]">{email}</span>.{' '}
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

export default InviteEmail;
