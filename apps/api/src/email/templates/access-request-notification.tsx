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
  organizationName: string;
  requesterName: string;
  requesterEmail: string;
  requesterCompany?: string | null;
  requesterJobTitle?: string | null;
  purpose?: string | null;
  requestedDurationDays?: number | null;
  reviewUrl: string;
  locale?: EmailLocale;
}

const copy = {
  en: {
    previewFrom: "New Trust Portal Access Request from",
    heading: "New Access Request",
    introPrefix: "A new request to access",
    introSuffix: "'s trust portal has been submitted and is awaiting your review.",
    requesterDetails: "Requester Details",
    nameLabel: "Name:",
    emailLabel: "Email:",
    companyLabel: "Company:",
    jobTitleLabel: "Job Title:",
    purposeTitle: "Purpose",
    durationLabel: "Requested Access Duration:",
    days: "days",
    reviewButton: "Review Request",
    actionRequired: "Action Required",
    actionBody:
      "Please review this request and either approve or deny access. Approved requests will require the requester to sign an NDA before accessing your trust portal.",
  },
  es: {
    previewFrom: "Nueva solicitud de acceso al Portal de Confianza de",
    heading: "Nueva solicitud de acceso",
    introPrefix: "Se ha enviado una nueva solicitud de acceso al portal de confianza de",
    introSuffix: " y está pendiente de tu revisión.",
    requesterDetails: "Datos del solicitante",
    nameLabel: "Nombre:",
    emailLabel: "Correo electrónico:",
    companyLabel: "Empresa:",
    jobTitleLabel: "Cargo:",
    purposeTitle: "Motivo",
    durationLabel: "Duración de acceso solicitada:",
    days: "días",
    reviewButton: "Revisar solicitud",
    actionRequired: "Acción requerida",
    actionBody:
      "Revisa esta solicitud y aprueba o deniega el acceso. Las solicitudes aprobadas requerirán que el solicitante firme un NDA antes de acceder a tu portal de confianza.",
  },
};

export const AccessRequestNotificationEmail = ({
  organizationName,
  requesterName,
  requesterEmail,
  requesterCompany,
  requesterJobTitle,
  purpose,
  requestedDurationDays,
  reviewUrl,
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
        <Preview>{t.previewFrom} {requesterName}</Preview>

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
              {t.introPrefix} <strong>{organizationName}</strong>{t.introSuffix}
            </Text>

            <Section
              className="mt-[20px] mb-[20px] rounded-[3px] p-[15px]"
              style={{ backgroundColor: '#f8f9fa' }}
            >
              <Text className="m-0 mb-[10px] text-[14px] font-semibold text-[#121212]">
                {t.requesterDetails}
              </Text>
              <Text className="m-0 text-[14px] leading-[20px] text-[#121212]">
                <strong>{t.nameLabel}</strong> {requesterName}
                <br />
                <strong>{t.emailLabel}</strong> {requesterEmail}
                {requesterCompany && (
                  <>
                    <br />
                    <strong>{t.companyLabel}</strong> {requesterCompany}
                  </>
                )}
                {requesterJobTitle && (
                  <>
                    <br />
                    <strong>{t.jobTitleLabel}</strong> {requesterJobTitle}
                  </>
                )}
              </Text>
            </Section>

            {purpose && (
              <Section className="mb-[20px]">
                <Text className="m-0 mb-[8px] text-[14px] font-semibold text-[#121212]">
                  {t.purposeTitle}
                </Text>
                <Text className="m-0 text-[14px] leading-[20px] text-[#121212]">
                  {purpose}
                </Text>
              </Section>
            )}

            {requestedDurationDays && (
              <Text className="text-[14px] leading-[24px] text-[#121212]">
                <strong>{t.durationLabel}</strong>{' '}
                {requestedDurationDays} {t.days}
              </Text>
            )}

            <Section className="mt-[32px] mb-[32px] text-center">
              <Button
                className="rounded-[3px] bg-[#121212] px-[20px] py-[12px] text-center text-[14px] font-semibold text-white no-underline"
                href={reviewUrl}
              >
                {t.reviewButton}
              </Button>
            </Section>

            <Section
              className="mt-[30px] mb-[20px] rounded-[3px] border-l-4 p-[15px]"
              style={{ backgroundColor: '#fff4e6', borderColor: '#f59e0b' }}
            >
              <Text className="m-0 text-[14px] leading-[24px] text-[#121212]">
                <strong>{t.actionRequired}</strong>
                <br />
                {t.actionBody}
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

export default AccessRequestNotificationEmail;
