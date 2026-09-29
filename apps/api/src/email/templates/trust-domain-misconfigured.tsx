import {
  Body,
  Button,
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
  toName: string;
  organizationName: string;
  domain: string;
  settingsUrl: string;
  locale?: EmailLocale;
}

const copy = {
  en: {
    previewPrefix: "Action required: Trust Portal custom domain",
    previewSuffix: "is misconfigured",
    heading: "Trust Portal Domain Needs Attention",
    hello: "Hello",
    bodyDetected: "We detected that the custom domain",
    bodyConfigured: "configured for",
    bodySuffix:
      "'s Trust Portal is no longer resolving correctly. Visitors using this domain may be unable to access your Trust Portal until the DNS configuration is fixed.",
    whatToDo: "What to do:",
    dnsBody:
      "Visit your Trust Portal settings to review the DNS records and re-verify your domain. Ensure your CNAME record points to the correct target and that all required verification records are in place.",
    reviewButton: "Review Domain Settings",
    supportNote: "If you need help, please contact our support team.",
  },
  es: {
    previewPrefix:
      "Acción requerida: el dominio personalizado del Portal de Confianza",
    previewSuffix: "está mal configurado",
    heading: "El dominio del Portal de Confianza necesita atención",
    hello: "Hola",
    bodyDetected: "Detectamos que el dominio personalizado",
    bodyConfigured: "configurado para el Portal de Confianza de",
    bodySuffix:
      " ya no se resuelve correctamente. Los visitantes que usen este dominio podrían no poder acceder a tu Portal de Confianza hasta que se corrija la configuración DNS.",
    whatToDo: "Qué hacer:",
    dnsBody:
      "Visita la configuración de tu Portal de Confianza para revisar los registros DNS y volver a verificar tu dominio. Asegúrate de que tu registro CNAME apunte al destino correcto y de que todos los registros de verificación requeridos estén en su lugar.",
    reviewButton: "Revisar la configuración del dominio",
    supportNote: "Si necesitas ayuda, contacta a nuestro equipo de soporte.",
  },
};

export const TrustDomainMisconfiguredEmail = ({
  toName,
  organizationName,
  domain,
  settingsUrl,
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
        <Preview>{t.previewPrefix} {domain} {t.previewSuffix}</Preview>

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
              {t.hello} {toName},
            </Text>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.bodyDetected} <strong>{domain}</strong> {t.bodyConfigured} <strong>{organizationName}</strong>{t.bodySuffix}
            </Text>

            <Section
              className="mt-[24px] mb-[24px] rounded-[3px] border-l-4 p-[15px]"
              style={{ backgroundColor: '#fff8f0', borderColor: '#f97316' }}
            >
              <Text className="m-0 text-[14px] leading-[24px] text-[#121212]">
                <strong>{t.whatToDo}</strong>
                <br />
                {t.dnsBody}
              </Text>
            </Section>

            <Section className="mt-[32px] mb-[32px] text-center">
              <Button
                className="rounded-[3px] bg-[#121212] px-[20px] py-[12px] text-center text-[14px] font-semibold text-white no-underline"
                href={settingsUrl}
              >
                {t.reviewButton}
              </Button>
            </Section>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.supportNote}
            </Text>

            <br />

            <Footer locale={locale} />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default TrustDomainMisconfiguredEmail;
