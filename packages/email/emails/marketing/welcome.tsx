import { Body, Container, Heading, Html, Preview, Tailwind, Text } from '@react-email/components';
import { Footer } from '../../components/footer';
import { Logo } from '../../components/logo';
import type { Locale } from '../../lib/locale';

interface Props {
  name: string;
  locale?: Locale;
}

const copy: Record<Locale, { preview: string; heading: string; body: string }> = {
  en: {
    preview: 'Get started with OpenComp',
    heading: 'Welcome to OpenComp!',
    body: 'Thanks for joining — let’s get your compliance on autopilot.',
  },
  es: {
    preview: 'Comienza con OpenComp',
    heading: '¡Bienvenido a OpenComp!',
    body: 'Gracias por unirte: pongamos tu cumplimiento en piloto automático.',
  },
};

export const WelcomeEmail = ({ name, locale = 'en' }: Props) => {
  void name;
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

            <Text className="text-center text-[14px] leading-[24px] text-[#121212]">{t.body}</Text>

            <Footer locale={locale} />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};
