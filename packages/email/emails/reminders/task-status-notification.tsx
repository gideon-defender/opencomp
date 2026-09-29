import {
  Body,
  Button,
  Container,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
} from '@react-email/components';
import { Footer } from '../../components/footer';
import { Logo } from '../../components/logo';
import { UnsubscribeLink } from '../../components/unsubscribe-link';
import type { Locale } from '../../lib/locale';
import { getUnsubscribeUrl } from '../../lib/unsubscribe';

interface Props {
  email: string;
  userName: string;
  taskName: string;
  taskStatus: 'failed' | 'todo';
  organizationName: string;
  taskUrl: string;
  locale?: Locale;
}

const copy: Record<
  Locale,
  {
    greeting: string;
    button: string;
    copyPaste: string;
    footer: string;
    failedLabel: string;
    reviewLabel: string;
    failedMessage: string;
    reviewMessage: string;
  }
> = {
  en: {
    greeting: 'Hello',
    button: 'View Task',
    copyPaste: 'or copy and paste this URL into your browser',
    footer: 'this notification was intended for',
    failedLabel: 'Failed',
    reviewLabel: 'Needs Review',
    failedMessage: 'Your task has failed its automated checks and requires your attention.',
    reviewMessage: 'Your task is past its review date and needs to be reviewed.',
  },
  es: {
    greeting: 'Hola',
    button: 'Ver tarea',
    copyPaste: 'o copia y pega esta URL en tu navegador',
    footer: 'esta notificación estaba destinada a',
    failedLabel: 'Fallida',
    reviewLabel: 'Necesita revisión',
    failedMessage:
      'Tu tarea no ha superado las comprobaciones automáticas y requiere tu atención.',
    reviewMessage: 'Tu tarea ha superado su fecha de revisión y debe ser revisada.',
  },
};

export const TaskStatusNotificationEmail = ({
  email,
  userName,
  taskName,
  taskStatus,
  organizationName,
  taskUrl,
  locale = 'en',
}: Props) => {
  const t = copy[locale];
  const statusLabel = taskStatus === 'failed' ? t.failedLabel : t.reviewLabel;
  const statusMessage = taskStatus === 'failed' ? t.failedMessage : t.reviewMessage;

  return (
    <Html lang={locale}>
      <Tailwind>
        <head />
        <Preview>
          Task &quot;{taskName}&quot; {statusLabel} - {organizationName}
        </Preview>

        <Body className="mx-auto my-auto bg-[#fff] font-sans">
          <Container
            className="mx-auto my-[40px] max-w-[600px] border-transparent p-[20px] md:border-[#E8E7E1]"
            style={{ borderStyle: 'solid', borderWidth: 1 }}
          >
            <Logo />
            <Heading className="mx-0 my-[30px] p-0 text-center text-[24px] font-normal text-[#121212]">
              Task {statusLabel}
            </Heading>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.greeting} {userName},
            </Text>

            {locale === 'es' ? (
              <Text className="text-[14px] leading-[24px] text-[#121212]">
                La tarea <strong>&quot;{taskName}&quot;</strong> de <strong>{organizationName}</strong>{' '}
                requiere tu atención.
              </Text>
            ) : (
              <Text className="text-[14px] leading-[24px] text-[#121212]">
                The task <strong>&quot;{taskName}&quot;</strong> in <strong>{organizationName}</strong>{' '}
                requires your attention.
              </Text>
            )}

            <Text className="text-[14px] leading-[24px] text-[#121212]">{statusMessage}</Text>

            <Section className="mt-[32px] mb-[42px] text-center">
              <Button
                className="text-primary border border-solid border-[#121212] bg-transparent px-6 py-3 text-center text-[14px] font-medium text-[#121212] no-underline"
                href={taskUrl}
              >
                {t.button}
              </Button>
            </Section>

            <Text className="text-[14px] leading-[24px] break-all text-[#707070]">
              {t.copyPaste}{' '}
              <Link href={taskUrl} className="text-[#707070] underline">
                {taskUrl}
              </Link>
            </Text>

            <br />
            <Section>
              <Text className="text-[12px] leading-[24px] text-[#666666]">
                {t.footer} <span className="text-[#121212]">{email}</span>.{' '}
              </Text>
            </Section>

            <UnsubscribeLink
              email={email}
              unsubscribeUrl={getUnsubscribeUrl(email)}
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

export default TaskStatusNotificationEmail;
