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
import { UnsubscribeLink } from '../components/unsubscribe-link';
import type { Locale } from '../lib/locale';
import { getUnsubscribeUrl } from '../lib/unsubscribe';

interface Props {
  email: string;
  userName: string;
  organizationName: string;
  completedAt: Date;
  locale?: Locale;
}

const copy: Record<
  Locale,
  {
    preview: string;
    heading: string;
    greeting: string;
    congrats: string;
    completionDate: string;
    certificate: string;
    thanks: string;
    footer: string;
  }
> = {
  en: {
    preview: "Congratulations! You've completed your Security Awareness Training",
    heading: 'Training Complete!',
    greeting: 'Hi',
    congrats:
      'Congratulations! You have successfully completed all Security Awareness Training modules for',
    completionDate: 'Completion Date',
    certificate:
      'Your training completion certificate is attached to this email. Please save it for your records.',
    thanks: 'Thank you for your commitment to maintaining security awareness and helping protect',
    footer: 'This notification was intended for',
  },
  es: {
    preview: '¡Felicidades! Has completado tu Formación en Concienciación sobre Seguridad',
    heading: '¡Formación completada!',
    greeting: 'Hola',
    congrats:
      '¡Felicidades! Has completado con éxito todos los módulos de Formación en Concienciación sobre Seguridad de',
    completionDate: 'Fecha de finalización',
    certificate:
      'Tu certificado de finalización de la formación se adjunta a este correo. Guárdalo para tus registros.',
    thanks:
      'Gracias por tu compromiso con la concienciación sobre seguridad y por ayudar a proteger',
    footer: 'Esta notificación estaba destinada a',
  },
};

export const TrainingCompletedEmail = ({
  email,
  userName,
  organizationName,
  completedAt,
  locale = 'en',
}: Props) => {
  const t = copy[locale];
  const formattedDate = new Date(completedAt).toLocaleDateString(
    locale === 'es' ? 'es-ES' : 'en-US',
    {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    },
  );

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
              {t.greeting} {userName},
            </Text>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.congrats} <strong>{organizationName}</strong>.
            </Text>

            <Section
              className="mt-[24px] mb-[24px] rounded-[8px] p-[24px] text-center"
              style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}
            >
              <Text className="m-0 text-[16px] font-medium text-[#166534]">
                {t.completionDate}: {formattedDate}
              </Text>
            </Section>

            <Text className="text-[14px] leading-[24px] text-[#121212]">{t.certificate}</Text>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.thanks} {organizationName}.
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

export default TrainingCompletedEmail;
