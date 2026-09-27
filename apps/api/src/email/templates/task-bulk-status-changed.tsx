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
  taskCount: number;
  newStatus: string;
  changedByName: string;
  organizationName: string;
  tasksUrl: string;
  locale?: EmailLocale;
}

const copy = {
  en: {
    previewChanged: "status changed to",
    task: "task",
    tasks: "tasks",
    heading: "Task Status Updated",
    hello: "Hello",
    bodyChanged: "changed the status of",
    bodyTo: "to",
    bodyIn: "in",
    viewTasks: "View Tasks",
    copyPaste: "or copy and paste this URL into your browser:",
    unsubscribeQuestion:
      "Don't want to receive task assignment notifications?",
    managePrefs: "Manage your email preferences",
  },
  es: {
    previewChanged: "estado cambiado a",
    task: "tarea",
    tasks: "tareas",
    heading: "Estado de tareas actualizado",
    hello: "Hola",
    bodyChanged: "cambió el estado de",
    bodyTo: "a",
    bodyIn: "en",
    viewTasks: "Ver tareas",
    copyPaste: "o copia y pega esta URL en tu navegador:",
    unsubscribeQuestion:
      "¿No quieres recibir notificaciones de asignación de tareas?",
    managePrefs: "Gestionar tus preferencias de correo electrónico",
  },
};

export const TaskBulkStatusChangedEmail = ({
  toName,
  toEmail,
  taskCount,
  newStatus,
  changedByName,
  organizationName,
  tasksUrl,
  locale = 'en',
}: Props) => {
  const t = copy[locale];

  const unsubscribeUrl = getUnsubscribeUrl(toEmail);
  const taskText = taskCount === 1 ? t.task : t.tasks;
  const statusText = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);

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
          {`${taskCount} ${taskText} ${t.previewChanged} ${statusText}`}
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
              <strong>{changedByName}</strong> {t.bodyChanged} <strong>{taskCount} {taskText}</strong> {t.bodyTo} <strong>{statusText}</strong> {t.bodyIn} <strong>{organizationName}</strong>.
            </Text>

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

export default TaskBulkStatusChangedEmail;
