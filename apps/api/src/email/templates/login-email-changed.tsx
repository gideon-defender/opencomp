import {
  Body,
  Container,
  Font,
  Heading,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
} from '@react-email/components';
import { Footer } from '../components/footer';
import { Logo } from '../components/logo';
import type { EmailLocale } from '../locale';

interface Props {
  organizationName: string;
  oldEmail: string;
  newEmail: string;
  locale?: EmailLocale;
}

const copy = {
  en: {
    preview: "Your OpenComp login email was changed",
    heading: "Your login email was changed",
    bodyPrefix: "An administrator of",
    bodyChangedFrom: "changed your OpenComp login email from",
    bodyTo: "to",
    fromNowOn: "From now on, use",
    toSignIn: "to sign in",
    unexpectedNote:
      "If you did not expect this change, contact your organization administrator or support@gideondefender.com.",
  },
  es: {
    preview: "Tu correo de inicio de sesión de OpenComp ha cambiado",
    heading: "Tu correo de inicio de sesión ha cambiado",
    bodyPrefix: "Un administrador de",
    bodyChangedFrom: "cambió tu correo de inicio de sesión de OpenComp de",
    bodyTo: "a",
    fromNowOn: "A partir de ahora, usa",
    toSignIn: "para iniciar sesión",
    unexpectedNote:
      "Si no esperabas este cambio, contacta al administrador de tu organización o a support@gideondefender.com.",
  },
};

export const LoginEmailChangedEmail = ({
  organizationName,
  oldEmail,
  newEmail,
  locale = 'en',
}: Props) => {
  const t = copy[locale];

  return (
    <Html lang={locale}>
      <Tailwind>
        <head>
          <Font
            fontFamily="Geist"
            fallbackFontFamily="Helvetica"
            fontWeight={400}
            fontStyle="normal"
          />
          <Font
            fontFamily="Geist"
            fallbackFontFamily="Helvetica"
            fontWeight={500}
            fontStyle="normal"
          />
        </head>
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
              {t.bodyPrefix} <span className="font-medium">{organizationName}</span> {t.bodyChangedFrom} <span className="font-medium">{oldEmail}</span> {t.bodyTo} <span className="font-medium">{newEmail}</span>.
            </Text>
            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.fromNowOn} <span className="font-medium">{newEmail}</span> {t.toSignIn}.
            </Text>

            <br />
            <Section>
              <Text className="text-[12px] leading-[24px] text-[#666666]">
                {t.unexpectedNote}
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

export default LoginEmailChangedEmail;
