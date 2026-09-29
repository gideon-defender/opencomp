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

interface TaskItem {
  title: string;
  url: string;
}

interface Props {
  toName: string;
  toEmail: string;
  taskCount: number;
  submittedByName: string;
  organizationName: string;
  tasksUrl: string;
  tasks: TaskItem[];
  locale?: EmailLocale;
}

const copy = {
  en: {
    previewSuffix: "submitted for your review",
    task: "task",
    tasks: "tasks",
    heading: "Evidence Review Requested",
    hello: "Hello",
    bodySubmitted: "has submitted",
    bodyForReview: "for your review in",
    reviewHint: "Please review the evidence and approve or reject each task:",
    reviewTasks: "Review Tasks",
    copyPaste: "or copy and paste this URL into your browser:",
    unsubscribeQuestion:
      "Don't want to receive task assignment notifications?",
    managePrefs: "Manage your email preferences",
  },
  es: {
    previewSuffix: "enviados para tu revisión",
    task: "tarea",
    tasks: "tareas",
    heading: "Revisión de evidencia solicitada",
    hello: "Hola",
    bodySubmitted: "ha enviado",
    bodyForReview: "para tu revisión en",
    reviewHint: "Revisa la evidencia y aprueba o rechaza cada tarea:",
    reviewTasks: "Revisar tareas",
    copyPaste: "o copia y pega esta URL en tu navegador:",
    unsubscribeQuestion:
      "¿No quieres recibir notificaciones de asignación de tareas?",
    managePrefs: "Gestionar tus preferencias de correo electrónico",
  },
};

export const EvidenceBulkReviewRequestedEmail = ({
  toName,
  toEmail,
  taskCount,
  submittedByName,
  organizationName,
  tasksUrl,
  tasks,
  locale = 'en',
}: Props) => {
  const t = copy[locale];

  const unsubscribeUrl = getUnsubscribeUrl(toEmail);
  const taskText = taskCount === 1 ? t.task : t.tasks;

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
          {`${taskCount} ${taskText} ${t.previewSuffix}`}
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
              <strong>{submittedByName}</strong> {t.bodySubmitted} {taskCount} {taskText} {t.bodyForReview} <strong>{organizationName}</strong>.
            </Text>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.reviewHint}
            </Text>

            <Section className="mt-[16px] mb-[16px]">
              {tasks.map((task, index) => (
                <Text
                  key={index}
                  className="my-[4px] text-[14px] leading-[24px] text-[#121212]"
                >
                  {'• '}
                  <Link href={task.url} className="text-[#121212] underline">
                    {task.title}
                  </Link>
                </Text>
              ))}
            </Section>

            <Section className="mt-[32px] mb-[32px] text-center">
              <Button
                className="rounded-[3px] bg-[#121212] px-[20px] py-[12px] text-center text-[14px] font-semibold text-white no-underline"
                href={tasksUrl}
              >
                {t.reviewTasks}
              </Button>
            </Section>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.copyPaste}{' '}
              <a href={tasksUrl} className="text-[#121212] underline">
                {tasksUrl}
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

export default EvidenceBulkReviewRequestedEmail;
