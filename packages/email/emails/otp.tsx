import {
  Body,
  Container,
  Heading,
  Html,
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
  otp: string;
  locale?: Locale;
}

const copy: Record<
  Locale,
  { preview: string; heading: string; intro: string; ignore: string; footer: string }
> = {
  en: {
    preview: 'One-Time Password for OpenComp',
    heading: 'Your one-time password for OpenComp',
    intro: 'Your one-time password for OpenComp is',
    ignore:
      'If you did not request this password, you can safely ignore this email. For support, please reach out to your IT / Security department.',
    footer: 'This one time password was intended for',
  },
  es: {
    preview: 'Contraseña de un solo uso para OpenComp',
    heading: 'Tu contraseña de un solo uso para OpenComp',
    intro: 'Tu contraseña de un solo uso para OpenComp es',
    ignore:
      'Si no solicitaste esta contraseña, puedes ignorar este correo de forma segura. Para obtener ayuda, comunícate con tu departamento de TI / Seguridad.',
    footer: 'Esta contraseña de un solo uso estaba destinada a',
  },
};

export const OTPVerificationEmail = ({ email, otp, locale = 'en' }: Props) => {
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
              Hey there,
              <br />
              <br />
              {t.intro}: {otp}. Please do not share this code with anyone.
            </Text>

            <Text className="text-[14px] leading-[24px] text-[#121212]">{t.ignore}</Text>

            <br />
            <Section>
              <Text className="text-[12px] leading-[24px] text-[#666666]">
                {t.footer} <span className="text-[#121212]">{email}</span>{' '}
                {locale === 'es' ? 'y caduca en 10 minutos.' : 'and expires in 10 minutes.'}
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
