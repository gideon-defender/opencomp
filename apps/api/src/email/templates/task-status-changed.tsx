import * as React from 'react';
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
import { UnsubscribeFooter } from '../components/unsubscribe-footer';

interface Props {
  toName: string;
  toEmail: string;
  taskTitle: string;
  oldStatus: string;
  newStatus: string;
  changedByName: string;
  organizationName: string;
  taskUrl: string;
  locale?: EmailLocale;
}

const copy = {
  en: {
    previewTask: "Task",
    previewChanged: "status changed from",
    previewTo: "to",
    heading: "Task Status Updated",
    hello: "Hello",
    bodyChanged: "changed the status of task",
    bodyFrom: "from",
    bodyTo: "to",
    bodyIn: "in",
    viewTask: "View Task",
    copyPaste: "or copy and paste this URL into your browser:",
    unsubscribeQuestion:
      "Don't want to receive task assignment notifications?",
  },
  es: {
    previewTask: "Tarea",
    previewChanged: "estado cambiado de",
    previewTo: "a",
    heading: "Estado de la tarea actualizado",
    hello: "Hola",
    bodyChanged: "cambió el estado de la tarea",
    bodyFrom: "de",
    bodyTo: "a",
    bodyIn: "en",
    viewTask: "Ver tarea",
    copyPaste: "o copia y pega esta URL en tu navegador:",
    unsubscribeQuestion:
      "¿No quieres recibir notificaciones de asignación de tareas?",
  },
};

export const TaskStatusChangedEmail = ({
  toName,
  toEmail,
  taskTitle,
  oldStatus,
  newStatus,
  changedByName,
  organizationName,
  taskUrl,
  locale = 'en',
}: Props) => {
  const t = copy[locale];

  const oldStatusText = oldStatus.charAt(0).toUpperCase() + oldStatus.slice(1);
  const newStatusText = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);

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
          {`${t.previewTask} "${taskTitle}" ${t.previewChanged} ${oldStatusText} ${t.previewTo} ${newStatusText}`}
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
              <strong>{changedByName}</strong> {t.bodyChanged} <strong>"{taskTitle}"</strong> {t.bodyFrom} <strong>{oldStatusText}</strong> {t.bodyTo} <strong>{newStatusText}</strong> {t.bodyIn} <strong>{organizationName}</strong>.
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

            <UnsubscribeFooter
              email={toEmail}
              message={t.unsubscribeQuestion}
              locale={locale}
            />

            <br />

            <Footer locale={locale} />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default TaskStatusChangedEmail;
