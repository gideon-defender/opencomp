import {
  Body,
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
import { getUnsubscribeUrl } from '@gideon-defender/email';
import { Footer } from '../components/footer';
import { Logo } from '../components/logo';
import type { EmailLocale } from '../locale';

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
  locale?: EmailLocale;
}



function getItemUrl(
  baseUrl: string,
  organizationId: string,
  item: UnassignedItem,
): string {
  const paths: Record<UnassignedItem['type'], string> = {
    task: 'tasks',
    policy: 'policies',
    risk: 'risk',
    vendor: 'vendors',
  };
  return `${baseUrl}/${organizationId}/${paths[item.type]}/${item.id}`;
}

const copy = {
  en: {
    preview: "Member removed - items require reassignment",
    heading: "Member Removed - Items Require Reassignment",
    hi: "Hi",
    removedPrefix: "has been removed from",
    reassignSuffix:
      ". As a result, the following items that were previously assigned to them now require a new assignee:",
    loginPrompt:
      "Please log in to assign these items to appropriate team members.",
    viewOrg: "View Organization",
    unsubscribe: "Unsubscribe",
  },
  es: {
    preview: "Miembro eliminado: elementos requieren reasignación",
    heading: "Miembro eliminado: elementos requieren reasignación",
    hi: "Hola",
    removedPrefix: "ha sido eliminado de",
    reassignSuffix:
      ". Como resultado, los siguientes elementos que tenía asignados ahora requieren un nuevo responsable:",
    loginPrompt:
      "Inicia sesión para asignar estos elementos a los miembros adecuados del equipo.",
    viewOrg: "Ver la organización",
    unsubscribe: "Cancelar suscripción",
  },
};

function itemTypeLabel(
  type: UnassignedItem["type"],
  locale: EmailLocale,
): string {
  const labels: Record<EmailLocale, Record<UnassignedItem["type"], string>> = {
    en: { task: "Tasks", policy: "Policies", risk: "Risks", vendor: "Vendors" },
    es: {
      task: "Tareas",
      policy: "Políticas",
      risk: "Riesgos",
      vendor: "Proveedores",
    },
  };
  return labels[locale][type];
}

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

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    'https://app.gideondefender.com';
  const link = `${baseUrl}/${organizationId}`;

  const groupedItems = unassignedItems.reduce(
    (acc, item) => {
      if (!acc[item.type]) acc[item.type] = [];
      acc[item.type].push(item);
      return acc;
    },
    {} as Record<UnassignedItem['type'], UnassignedItem[]>,
  );

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
              {t.hi} {userName},
            </Text>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              <strong>{removedMemberName}</strong> {t.removedPrefix} <strong>{organizationName}</strong>{t.reassignSuffix}
            </Text>

            {Object.entries(groupedItems).map(([type, items]) => (
              <Section key={type} className="my-[12px]">
                <Text className="text-[16px] font-medium text-[#121212] mb-[8px] mt-0">
                  {itemTypeLabel(type as UnassignedItem['type'], locale)} (
                  {items.length})
                </Text>
                <ul className="list-disc pl-[12px]">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="text-[14px] leading-[24px] text-[#121212]"
                    >
                      <Link
                        href={getItemUrl(baseUrl, organizationId, item)}
                        className="text-[#121212] underline"
                      >
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
                {t.viewOrg}
              </a>
            </Section>

            {email && (
              <Section>
                <Text className="text-[12px] leading-[24px] text-[#666666]">
                  <Link
                    href={getUnsubscribeUrl(email)}
                    className="text-[#121212] underline"
                  >
                    {t.unsubscribe}
                  </Link>
                </Text>
              </Section>
            )}

            <br />
            <Footer locale={locale} />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};
