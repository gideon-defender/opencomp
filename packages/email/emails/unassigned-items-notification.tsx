import {
  Body,
  Container,
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
import { UnsubscribeLink } from '../components/unsubscribe-link';
import type { Locale } from '../lib/locale';
import { getUnsubscribeUrl } from '../lib/unsubscribe';

interface UnassignedItem {
  type: 'task' | 'policy' | 'risk' | 'vendor';
  id: string;
  name: string;
}

interface Props {
  userName: string;
  organizationName: string;
  organizationId: string;
  removedMemberName: string;
  unassignedItems: UnassignedItem[];
  email?: string;
  locale?: Locale;
}

const copy: Record<
  Locale,
  { preview: string; heading: string; greeting: string; cta: string; loginPrompt: string }
> = {
  en: {
    preview: 'Member removed - items require reassignment',
    heading: 'Member Removed - Items Require Reassignment',
    greeting: 'Hi',
    cta: 'View Organization',
    loginPrompt: 'Please log in to assign these items to appropriate team members.',
  },
  es: {
    preview: 'Miembro eliminado: los elementos requieren reasignación',
    heading: 'Miembro eliminado: los elementos requieren reasignación',
    greeting: 'Hola',
    cta: 'Ver organización',
    loginPrompt: 'Inicia sesión para asignar estos elementos a los miembros adecuados del equipo.',
  },
};

const itemLabels: Record<Locale, Record<UnassignedItem['type'], string>> = {
  en: { task: 'Task', policy: 'Policy', risk: 'Risk', vendor: 'Vendor' },
  es: { task: 'Tarea', policy: 'Política', risk: 'Riesgo', vendor: 'Proveedor' },
};

export const UnassignedItemsNotificationEmail = ({
  userName,
  organizationName,
  organizationId,
  removedMemberName,
  unassignedItems,
  email,
  locale = 'en',
}: Props) => {
  const t = copy[locale];
  const baseUrl = process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? 'https://app.gideondefender.com';
  const link = `${baseUrl}/${organizationId}`;

  const getItemTypeLabel = (type: UnassignedItem['type']) => itemLabels[locale][type];

  const getItemUrl = (item: UnassignedItem) => {
    switch (item.type) {
      case 'task':
        return `${baseUrl}/${organizationId}/tasks/${item.id}`;
      case 'policy':
        return `${baseUrl}/${organizationId}/policies/${item.id}`;
      case 'risk':
        return `${baseUrl}/${organizationId}/risk/${item.id}`;
      case 'vendor':
        return `${baseUrl}/${organizationId}/vendors/${item.id}`;
    }
  };

  const groupedItems = unassignedItems.reduce(
    (acc, item) => {
      if (!acc[item.type]) {
        acc[item.type] = [];
      }
      acc[item.type].push(item);
      return acc;
    },
    {} as Record<UnassignedItem['type'], UnassignedItem[]>,
  );

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

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.greeting} {userName},
            </Text>

            {locale === 'es' ? (
              <Text className="text-[14px] leading-[24px] text-[#121212]">
                <strong>{removedMemberName}</strong> ha sido eliminado de{' '}
                <strong>{organizationName}</strong>. Por ello, los siguientes elementos que tenía
                asignados ahora requieren un nuevo responsable:
              </Text>
            ) : (
              <Text className="text-[14px] leading-[24px] text-[#121212]">
                <strong>{removedMemberName}</strong> has been removed from{' '}
                <strong>{organizationName}</strong>. As a result, the following items that were
                previously assigned to them now require a new assignee:
              </Text>
            )}

            {Object.entries(groupedItems).map(([type, items]) => (
              <Section key={type} className="my-[12px]">
                <Text className="text-[16px] font-medium text-[#121212] mb-[8px] mt-0">
                  {getItemTypeLabel(type as UnassignedItem['type'])}s ({items.length})
                </Text>
                <ul className="list-disc pl-[12px]">
                  {items.map((item) => (
                    <li key={item.id} className="text-[14px] leading-[24px] text-[#121212]">
                      <Link href={getItemUrl(item)} className="text-[#121212] underline">
                        {item.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Section>
            ))}

            <Text className="text-[14px] leading-[24px] text-[#121212] mt-[24px]">
              {t.loginPrompt}
            </Text>

            <Section className="mt-[32px] mb-[42px] text-center">
              <a
                href={link}
                className="text-primary border border-solid border-[#121212] bg-transparent px-6 py-3 text-center text-[14px] font-medium text-[#121212] no-underline inline-block"
              >
                {t.cta}
              </a>
            </Section>

            {email && (
              <UnsubscribeLink
                email={email}
                unsubscribeUrl={getUnsubscribeUrl(email)}
                locale={locale}
              />
            )}

            <br />

            <Footer locale={locale} />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default UnassignedItemsNotificationEmail;
