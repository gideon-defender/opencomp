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
import { formatDateForLocale, type EmailLocale } from '../locale';

interface Props {
  toName: string;
  organizationName: string;
  accessLink: string;
  expiresAt: Date;
  locale?: EmailLocale;
}

const copy = {
  en: {
    preview: "Access Your Compliance Data",
    heading: "Access Your Data",
    hello: "Hello",
    requestedPrefix: "You requested access to",
    requestedSuffix: "'s compliance documentation.",
    clickBelow: "Click the button below to access your data:",
    button: "Access Compliance Data",
    copyPaste: "or copy and paste this URL into your browser",
    linkValid: "This link will remain valid until your access expires on:",
  },
  es: {
    preview: "Accede a tus datos de cumplimiento",
    heading: "Accede a tus datos",
    hello: "Hola",
    requestedPrefix: "Solicitaste acceso a la documentación de cumplimiento de",
    requestedSuffix: ".",
    clickBelow: "Haz clic en el botón siguiente para acceder a tus datos:",
    button: "Acceder a los datos de cumplimiento",
    copyPaste: "o copia y pega esta URL en tu navegador",
    linkValid: "Este enlace seguirá siendo válido hasta que tu acceso venza el:",
  },
};

export const AccessReclaimEmail = ({
  toName,
  organizationName,
  accessLink,
  expiresAt,
  locale = 'en',
}: Props) => {
  const t = copy[locale];

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
        <Preview>{t.preview} - {organizationName}</Preview>

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
              {t.requestedPrefix} <strong>{organizationName}</strong>{t.requestedSuffix}
            </Text>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.clickBelow}
            </Text>

            <Section className="mt-[32px] mb-[42px] text-center">
              <Button
                className="text-primary border border-solid border-[#121212] bg-transparent px-6 py-3 text-center text-[14px] font-medium text-[#121212] no-underline"
                href={accessLink}
              >
                {t.button}
              </Button>
            </Section>

            <Text className="text-[14px] leading-[24px] break-all text-[#707070]">
              {t.copyPaste}{' '}
              <Link href={accessLink} className="text-[#707070] underline">
                {accessLink}
              </Link>
            </Text>

            <br />
            <Section>
              <Text className="text-[12px] leading-[24px] text-[#666666]">
                {t.linkValid}{' '}
                <strong>
                  {formatDateForLocale(expiresAt, locale, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </strong>
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

export default AccessReclaimEmail;
