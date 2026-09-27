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
  mentionedByName: string;
  entityName: string;
  entityRoutePath: string; // 'vendors' or 'risks'
  entityId: string;
  organizationId: string;
  taskUrl: string;
  locale?: EmailLocale;
}

const copy = {
  en: {
    previewSuffix: "mentioned you in a task",
    heading: "You were mentioned in a task",
    hello: "Hello",
    bodyMentioned: "mentioned you in the task",
    bodyFor: "for",
    viewTask: "View Task",
    copyPaste: "or copy and paste this URL into your browser:",
    unsubscribeQuestion: "Don't want to receive task mention notifications?",
    managePrefs: "Manage your email preferences",
  },
  es: {
    previewSuffix: "te mencionó en una tarea",
    heading: "Te mencionaron en una tarea",
    hello: "Hola",
    bodyMentioned: "te mencionó en la tarea",
    bodyFor: "para",
    viewTask: "Ver tarea",
    copyPaste: "o copia y pega esta URL en tu navegador:",
    unsubscribeQuestion:
      "¿No quieres recibir notificaciones de menciones en tareas?",
    managePrefs: "Gestionar tus preferencias de correo electrónico",
  },
};

export const TaskItemMentionedEmail = ({
  toName,
  toEmail,
  taskTitle,
  mentionedByName,
  entityName,
  entityRoutePath,
  entityId,
  organizationId,
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
        <Preview>{mentionedByName} {t.previewSuffix}</Preview>

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
              <strong>{mentionedByName}</strong> {t.bodyMentioned} <strong>"{taskTitle}"</strong> {t.bodyFor} <strong>{entityName}</strong>.
            </Text>

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

export default TaskItemMentionedEmail;
