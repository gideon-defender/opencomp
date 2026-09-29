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
  name: string;
  dueDate: string;
  recordId: string;
  locale?: Locale;
}

const copy: Record<
  Locale,
  { preview: string; heading: string; button: string; copyPaste: string; footer: string }
> = {
  en: {
    preview: 'OpenComp - Task Reminder',
    heading: 'Task Reminder',
    button: 'Open Task',
    copyPaste: 'or copy and paste this URL into your browser',
    footer: 'this notification was intended for',
  },
  es: {
    preview: 'OpenComp: recordatorio de tarea',
    heading: 'Recordatorio de tarea',
    button: 'Abrir tarea',
    copyPaste: 'o copia y pega esta URL en tu navegador',
    footer: 'esta notificación estaba destinada a',
  },
};

export const TaskReminderEmail = ({ email, name, dueDate, recordId, locale = 'en' }: Props) => {
  const t = copy[locale];
  const link = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.gideondefender.com'}${recordId}`;

  return (
    <Html lang={locale}>
      <Tailwind>
        <head />
        <Preview>{t.preview}</Preview>

        <Body className="mx-auto my-auto bg-[#fff] font-sans">
          <Container
            className="mx-auto my-[40px] max-w-[600px] border-transparent p-[20px] md:border-[#E8E7E1]"
            style={{ borderStyle: 'solid', borderWidth: 1 }}
          >
            <Logo />
            <Heading className="mx-0 my-[30px] p-0 text-center text-[24px] font-normal text-[#121212]">
              {t.heading}
            </Heading>

            {locale === 'es' ? (
              <Text className="text-[14px] leading-[24px] text-[#121212]">
                Hola {name}, tienes asignada una tarea que vence pronto ({dueDate}).
              </Text>
            ) : (
              <Text className="text-[14px] leading-[24px] text-[#121212]">
                Hey {name}, you&apos;re assigned to a task that is due soon ({dueDate}).
              </Text>
            )}
            <Section className="mt-[32px] mb-[42px] text-center">
              <Button
                className="text-primary border border-solid border-[#121212] bg-transparent px-6 py-3 text-center text-[14px] font-medium text-[#121212] no-underline"
                href={link}
              >
                {t.button}
              </Button>
            </Section>

            <Text className="text-[14px] leading-[24px] break-all text-[#707070]">
              {t.copyPaste}{' '}
              <Link href={link} className="text-[#707070] underline">
                {link}
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

export default TaskReminderEmail;
