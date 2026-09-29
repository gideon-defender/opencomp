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
  taskTitle: string;
  failedCount: number;
  totalCount: number;
  taskStatusChanged: boolean;
  organizationName: string;
  taskUrl: string;
  locale?: EmailLocale;
}

const copy = {
  en: {
    previewOf: "of",
    previewAutomations: "automation(s) failed on task",
    heading: "Automation Failures",
    hello: "Hello",
    bodyOf: "of",
    bodyAutomations: "automation(s) failed on task",
    bodyIn: "in",
    statusPrefix: "Task status has been changed to",
    failedStatus: "Failed",
    viewTask: "View Task",
    copyPaste: "or copy and paste this URL into your browser:",
    unsubscribeQuestion:
      "Don't want to receive task assignment notifications?",
    managePrefs: "Manage your email preferences",
  },
  es: {
    previewOf: "de",
    previewAutomations: "automatizaciones fallaron en la tarea",
    heading: "Fallos de automatización",
    hello: "Hola",
    bodyOf: "de",
    bodyAutomations: "automatizaciones fallaron en la tarea",
    bodyIn: "en",
    statusPrefix: "El estado de la tarea ha cambiado a",
    failedStatus: "Fallida",
    viewTask: "Ver tarea",
    copyPaste: "o copia y pega esta URL en tu navegador:",
    unsubscribeQuestion:
      "¿No quieres recibir notificaciones de asignación de tareas?",
    managePrefs: "Gestionar tus preferencias de correo electrónico",
  },
};

export const AutomationFailuresEmail = ({
  toName,
  toEmail,
  taskTitle,
  failedCount,
  totalCount,
  taskStatusChanged,
  organizationName,
  taskUrl,
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
        <Preview>
          {`${failedCount} ${t.previewOf} ${totalCount} ${t.previewAutomations} "${taskTitle}"`}
        </Preview>

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
              <strong>{failedCount}</strong> {t.bodyOf} <strong>{totalCount}</strong> {t.bodyAutomations} <strong>"{taskTitle}"</strong> {t.bodyIn} <strong>{organizationName}</strong>.
            </Text>

            {taskStatusChanged && (
              <Text className="text-[14px] leading-[24px] text-[#121212]">
                {t.statusPrefix} <strong>{t.failedStatus}</strong>.
              </Text>
            )}

            <Section className="mt-[32px] mb-[32px] text-center">
              <Button
                className="rounded-[3px] bg-[#121212] px-[20px] py-[12px] text-center text-[14px] font-semibold text-white no-underline"
                href={taskUrl}
              >
                {t.viewTask}
              </Button>
            </Section>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.copyPaste}{' '}
              <a href={taskUrl} className="text-[#121212] underline">
                {taskUrl}
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

export default AutomationFailuresEmail;
