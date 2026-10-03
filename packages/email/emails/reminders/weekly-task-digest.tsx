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
  organizationName: string;
  organizationId: string;
  tasks: Array<{
    id: string;
    title: string;
  }>;
  locale?: Locale;
}

const getTaskCountMessage = (count: number, locale: Locale) => {
  if (locale === 'es') {
    return count === 1
      ? 'Tienes 1 tarea pendiente aún sin completar'
      : `Tienes ${count} tareas pendientes aún sin completar`;
  }
  const plural = count !== 1 ? 's' : '';
  return `You have ${count} pending task${plural} that are not yet completed`;
};

const copy: Record<
  Locale,
  { heading: string; greeting: string; button: string; copyPaste: string; footer: string }
> = {
  en: {
    heading: 'Weekly Task Reminder',
    greeting: 'Hi',
    button: 'View All Tasks',
    copyPaste: 'or copy and paste this URL into your browser',
    footer: 'This notification was intended for',
  },
  es: {
    heading: 'Recordatorio semanal de tareas',
    greeting: 'Hola',
    button: 'Ver todas las tareas',
    copyPaste: 'o copia y pega esta URL en tu navegador',
    footer: 'Esta notificación estaba destinada a',
  },
};

export const WeeklyTaskDigestEmail = ({
  email,
  userName,
  organizationName,
  organizationId,
  tasks,
  locale = 'en',
}: Props) => {
  const t = copy[locale];
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.gideondefender.com';
  const tasksUrl = `${baseUrl}/${organizationId}/tasks`;
  const taskCountMessage = getTaskCountMessage(tasks.length, locale);

  return (
    <Html lang={locale}>
      <Tailwind>
        <head />
        <Preview>{taskCountMessage}</Preview>

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
              {t.greeting} {userName},
            </Text>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {taskCountMessage} {locale === 'es' ? 'en' : 'in'} <strong>{organizationName}</strong>
              :
            </Text>

            <Section className="my-[24px]">
              <ul className="list-disc pl-[20px]">
                {tasks.map((task) => (
                  <li key={task.id} className="text-[14px] leading-[28px] text-[#121212]">
                    <Link
                      href={`${tasksUrl}/${task.id}`}
                      className="text-[#121212] underline hover:text-[#666666]"
                    >
                      {task.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>

            <Section className="mt-[32px] mb-[42px] text-center">
              <Button
                className="text-primary border border-solid border-[#121212] bg-transparent px-6 py-3 text-center text-[14px] font-medium text-[#121212] no-underline"
                href={tasksUrl}
              >
                {t.button}
              </Button>
            </Section>

            <Text className="text-[14px] leading-[24px] break-all text-[#707070]">
              {t.copyPaste}{' '}
              <Link href={tasksUrl} className="text-[#707070] underline">
                {tasksUrl}
              </Link>
            </Text>

            <br />
            <Section>
              <Text className="text-[12px] leading-[24px] text-[#666666]">
                {t.footer} <span className="text-[#121212]">{email}</span>.
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

export default WeeklyTaskDigestEmail;
