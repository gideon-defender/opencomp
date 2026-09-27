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

interface FailedTaskItem {
  title: string;
  url: string;
  failedCount: number;
  totalCount: number;
}

interface Props {
  toName: string;
  toEmail: string;
  organizationName: string;
  tasksUrl: string;
  tasks: FailedTaskItem[];
  locale?: EmailLocale;
}

const MAX_DISPLAYED_TASKS = 15;

const copy = {
  en: {
    previewSuffix: "with automation failures",
    task: "task",
    tasks: "tasks",
    heading: "Automation Failures Summary",
    hello: "Hello",
    bodyPrefix: "Today's scheduled automations found failures in",
    bodyIn: "in",
    failed: "failed",
    andMorePrefix: "and",
    andMoreSuffix: "more...",
    viewTasks: "View Tasks",
    copyPaste: "or copy and paste this URL into your browser:",
    unsubscribeQuestion:
      "Don't want to receive task assignment notifications?",
    managePrefs: "Manage your email preferences",
  },
  es: {
    previewSuffix: "con fallos de automatización",
    task: "tarea",
    tasks: "tareas",
    heading: "Resumen de fallos de automatización",
    hello: "Hola",
    bodyPrefix: "Las automatizaciones programadas de hoy encontraron fallos en",
    bodyIn: "en",
    failed: "fallidos",
    andMorePrefix: "y",
    andMoreSuffix: "más...",
    viewTasks: "Ver tareas",
    copyPaste: "o copia y pega esta URL en tu navegador:",
    unsubscribeQuestion:
      "¿No quieres recibir notificaciones de asignación de tareas?",
    managePrefs: "Gestionar tus preferencias de correo electrónico",
  },
};

export const AutomationBulkFailuresEmail = ({
  toName,
  toEmail,
  organizationName,
  tasksUrl,
  tasks,
  locale = 'en',
}: Props) => {
  const t = copy[locale];

  const unsubscribeUrl = getUnsubscribeUrl(toEmail);
  const taskCount = tasks.length;
  const taskText = taskCount === 1 ? t.task : t.tasks;
  const displayedTasks = tasks.slice(0, MAX_DISPLAYED_TASKS);
  const remainingCount = taskCount - displayedTasks.length;

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
        <Preview>{`${taskCount} ${taskText} ${t.previewSuffix}`}</Preview>

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
              {t.bodyPrefix} <strong>{taskCount}</strong> {taskText} {t.bodyIn} <strong>{organizationName}</strong>.
            </Text>

            <Section className="mt-[16px] mb-[16px]">
              {displayedTasks.map((task, index) => (
                <Text
                  key={index}
                  className="my-[4px] text-[14px] leading-[24px] text-[#121212]"
                >
                  {'• '}
                  <Link href={task.url} className="text-[#121212] underline">
                    {task.title}
                  </Link>{' '}
                  ({task.failedCount}/{task.totalCount} {t.failed})
                </Text>
              ))}
              {remainingCount > 0 && (
                <Text className="my-[4px] text-[14px] leading-[24px] text-[#666666]">
                  {t.andMorePrefix} {remainingCount} {t.andMoreSuffix}
                </Text>
              )}
            </Section>

            <Section className="mt-[32px] mb-[32px] text-center">
              <Button
                className="rounded-[3px] bg-[#121212] px-[20px] py-[12px] text-center text-[14px] font-semibold text-white no-underline"
                href={tasksUrl}
              >
                {t.viewTasks}
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

export default AutomationBulkFailuresEmail;
