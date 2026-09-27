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
import { formatDateForLocale, type EmailLocale } from '../locale';

interface Props {
  toName: string;
  organizationName: string;
  expiresAt: Date;
  portalUrl: string;
  /**
   * When true, access was granted without an NDA (the requester's email or
   * domain is on the trust portal allow list). NDA-specific copy is omitted.
   */
  ndaBypassed?: boolean;
  locale?: EmailLocale;
}

const copy = {
  en: {
    preview: "Access Granted",
    heading: "Access Granted ✓",
    hello: "Hello",
    activeBypassedPrefix: "Your access to",
    activeBypassedSuffix: "'s policy documentation is now active.",
    activeNdaPrefix: "Your NDA has been signed and your access to",
    activeNdaSuffix: "'s policy documentation is now active.",
    expiresOn: "Your access will expire on:",
    viewDocuments: "View Documents",
    downloadNda:
      "You can download your signed NDA for your records from the confirmation page or by accessing the portal above.",
    lostLink: "Lost your access link?",
    lostLinkBody:
      'Visit the trust portal and click "Already have access?" to receive a new access link via email.',
  },
  es: {
    preview: "Acceso concedido",
    heading: "Acceso concedido ✓",
    hello: "Hola",
    activeBypassedPrefix: "Tu acceso a la documentación de políticas de",
    activeBypassedSuffix: " ya está activo.",
    activeNdaPrefix:
      "Tu NDA ha sido firmado y tu acceso a la documentación de políticas de",
    activeNdaSuffix: " ya está activo.",
    expiresOn: "Tu acceso vencerá el:",
    viewDocuments: "Ver documentos",
    downloadNda:
      "Puedes descargar tu NDA firmado para tus registros desde la página de confirmación o accediendo al portal anterior.",
    lostLink: "¿Perdiste tu enlace de acceso?",
    lostLinkBody:
      "Visita el portal de confianza y haz clic en «¿Ya tienes acceso?» para recibir un nuevo enlace de acceso por correo electrónico.",
  },
};

export const AccessGrantedEmail = ({
  toName,
  organizationName,
  expiresAt,
  portalUrl,
  ndaBypassed = false,
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
        <Preview>{t.preview} - {organizationName}</Preview>

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
              {ndaBypassed ? (
                <>
                  {t.activeBypassedPrefix} <strong>{organizationName}</strong>{t.activeBypassedSuffix}
                </>
              ) : (
                <>
                  {t.activeNdaPrefix} <strong>{organizationName}</strong>{t.activeNdaSuffix}
                </>
              )}
            </Text>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.expiresOn}{' '}
              <strong>
                {formatDateForLocale(expiresAt, locale, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </strong>
            </Text>

            <Section className="mt-[32px] mb-[32px] text-center">
              <Button
                className="rounded-[3px] bg-[#121212] px-[20px] py-[12px] text-center text-[14px] font-semibold text-white no-underline"
                href={portalUrl}
              >
                {t.viewDocuments}
              </Button>
            </Section>

            {!ndaBypassed && (
              <Text className="text-[14px] leading-[24px] text-[#121212]">
                {t.downloadNda}
              </Text>
            )}

            <Section
              className="mt-[30px] mb-[20px] rounded-[3px] border-l-4 p-[15px]"
              style={{ backgroundColor: '#f8f9fa', borderColor: '#121212' }}
            >
              <Text className="m-0 text-[14px] leading-[24px] text-[#121212]">
                <strong>{t.lostLink}</strong>
                <br />
                {t.lostLinkBody}
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

export default AccessGrantedEmail;
