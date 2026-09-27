import * as React from 'react';
import {
  Body,
  Button,
  Container,
  Font,
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
import type { EmailLocale } from '../locale';
import { getUnsubscribeUrl } from '@gideon-defender/email';

interface Props {
  toName: string;
  toEmail: string;
  organizationName: string;
  requesterName: string;
  accountsNeeded: string;
  permissionsNeeded: string;
  reasonForRequest: string;
  reviewUrl: string;
  locale?: EmailLocale;
}

const copy = {
  en: {
    previewFrom: "New access request from",
    heading: "New Access Request",
    hello: "Hello",
    bodySubmitted: "submitted an access request in",
    detailsTitle: "Request Details",
    accountsLabel: "Accounts Needed:",
    permissionsLabel: "Permissions Needed:",
    reviewButton: "Review Request",
    copyPaste: "or copy and paste this URL into your browser:",
    unsubscribeQuestion:
      "Don't want to receive access request notifications?",
    managePrefs: "Manage your email preferences",
  },
  es: {
    previewFrom: "Nueva solicitud de acceso de",
    heading: "Nueva solicitud de acceso",
    hello: "Hola",
    bodySubmitted: "envió una solicitud de acceso en",
    detailsTitle: "Datos de la solicitud",
    accountsLabel: "Cuentas necesarias:",
    permissionsLabel: "Permisos necesarios:",
    reviewButton: "Revisar solicitud",
    copyPaste: "o copia y pega esta URL en tu navegador:",
    unsubscribeQuestion:
      "¿No quieres recibir notificaciones de solicitudes de acceso?",
    managePrefs: "Gestionar tus preferencias de correo electrónico",
  },
};

export const EvidenceAccessRequestSubmittedEmail = ({
  toName,
  toEmail,
  organizationName,
  requesterName,
  accountsNeeded,
  permissionsNeeded,
  reasonForRequest,
  reviewUrl,
  locale = 'en',
}: Props) => {
  const t = copy[locale];

  const unsubscribeUrl = getUnsubscribeUrl(toEmail);

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
              {t.hello} {toName},
            </Text>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              <strong>{requesterName}</strong> {t.bodySubmitted} <strong>{organizationName}</strong>.
            </Text>

            <Section
              className="mt-[24px] mb-[24px] rounded-[8px] bg-[#f5f5f5] p-[16px]"
              style={{ border: '1px solid #e0e0e0' }}
            >
              <Text className="m-0 text-[12px] font-medium uppercase tracking-wide text-[#666666]">
                {t.detailsTitle}
              </Text>

              <Text className="mt-[8px] mb-[4px] text-[14px] font-medium text-[#121212]">
                {t.accountsLabel} {accountsNeeded}
              </Text>

              <Text className="mt-[4px] mb-[4px] text-[14px] font-medium text-[#121212]">
                {t.permissionsLabel} {permissionsNeeded}
              </Text>

              <Text className="mt-[12px] mb-0 text-[13px] italic text-[#444444]">
                "{reasonForRequest}"
              </Text>
            </Section>

            <Section className="mt-[32px] mb-[32px] text-center">
              <Button
                className="rounded-[3px] bg-[#121212] px-[20px] py-[12px] text-center text-[14px] font-semibold text-white no-underline"
                href={reviewUrl}
              >
                {t.reviewButton}
              </Button>
            </Section>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.copyPaste}{' '}
              <a href={reviewUrl} className="text-[#121212] underline">
                {reviewUrl}
              </a>
            </Text>

            <Section className="mt-[30px] mb-[20px]">
              <Text className="text-[12px] leading-[20px] text-[#666666]">
                {t.unsubscribeQuestion}{' '}
                <Link
                  href={unsubscribeUrl}
                  className="text-[#121212] underline"
                >
                  {t.managePrefs}
                </Link>
                .
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

export default EvidenceAccessRequestSubmittedEmail;
