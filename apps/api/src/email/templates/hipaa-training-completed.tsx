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
import { formatDateForLocale, type EmailLocale } from '../locale';

interface Props {
  email: string;
  userName: string;
  organizationName: string;
  completedAt: Date;
  locale?: EmailLocale;
}

const copy = {
  en: {
    preview:
      "Congratulations! You've completed your HIPAA Security Awareness Training",
    heading: "HIPAA Training Complete!",
    hi: "Hi",
    congratsPrefix:
      "Congratulations! You have successfully completed the HIPAA Security Awareness Training for",
    completionDate: "Completion Date:",
    certAttached:
      "Your HIPAA training completion certificate is attached to this email. Please save it for your records.",
    thanksPrefix:
      "Thank you for your commitment to protecting PHI and maintaining HIPAA compliance at",
    intendedFor: "This notification was intended for",
  },
  es: {
    preview:
      "¡Felicidades! Has completado tu formación de concienciación en seguridad HIPAA",
    heading: "¡Formación HIPAA completada!",
    hi: "Hola",
    congratsPrefix:
      "¡Felicidades! Has completado con éxito la formación de concienciación en seguridad HIPAA de",
    completionDate: "Fecha de finalización:",
    certAttached:
      "Tu certificado de finalización de la formación HIPAA está adjunto a este correo. Guárdalo para tus registros.",
    thanksPrefix:
      "Gracias por tu compromiso con la protección de la PHI y el mantenimiento del cumplimiento HIPAA en",
    intendedFor: "Esta notificación estaba destinada a",
  },
};

export const HipaaTrainingCompletedEmail = ({
  email,
  userName,
  organizationName,
  completedAt,
  locale = 'en',
}: Props) => {
  const t = copy[locale];

  const formattedDate = formatDateForLocale(new Date(completedAt), locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

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
              {t.hi} {userName},
            </Text>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.congratsPrefix} <strong>{organizationName}</strong>.
            </Text>

            <Section
              className="mt-[24px] mb-[24px] rounded-[8px] p-[24px] text-center"
              style={{
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
              }}
            >
              <Text className="m-0 text-[16px] font-medium text-[#166534]">
                {t.completionDate} {formattedDate}
              </Text>
            </Section>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.certAttached}
            </Text>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.thanksPrefix} {organizationName}.
            </Text>

            <br />
            <Section>
              <Text className="text-[12px] leading-[24px] text-[#666666]">
                {t.intendedFor}{' '}
                <span className="text-[#121212]">{email}</span>.
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

export default HipaaTrainingCompletedEmail;
