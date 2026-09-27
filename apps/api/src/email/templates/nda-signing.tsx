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

interface Props {
  toName: string;
  organizationName: string;
  ndaSigningLink: string;
  locale?: EmailLocale;
}

const copy = {
  en: {
    preview: "NDA Signature Required",
    heading: "NDA Signature Required",
    hello: "Hello",
    requestPrefix: "Your request to",
    requestSuffix: "'s trust portal has been approved.",
    mustSign:
      "Before you can access the policy documentation, you must review and sign a Non-Disclosure Agreement (NDA).",
    button: "Review and Sign NDA",
    copyPaste: "or copy and paste this URL into your browser",
    expiryNote:
      "This link will expire in 7 days. If you need a new link, please contact the organization.",
  },
  es: {
    preview: "Firma del NDA requerida",
    heading: "Firma del NDA requerida",
    hello: "Hola",
    requestPrefix: "Tu solicitud al portal de confianza de",
    requestSuffix: " ha sido aprobada.",
    mustSign:
      "Antes de poder acceder a la documentación de políticas, debes revisar y firmar un Acuerdo de No Divulgación (NDA).",
    button: "Revisar y firmar el NDA",
    copyPaste: "o copia y pega esta URL en tu navegador",
    expiryNote:
      "Este enlace vencerá en 7 días. Si necesitas un nuevo enlace, contacta a la organización.",
  },
};

export const NdaSigningEmail = ({
  toName,
  organizationName,
  ndaSigningLink,
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
              {t.requestPrefix} <strong>{organizationName}</strong>{t.requestSuffix}
            </Text>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              <strong>{t.mustSign}</strong>
            </Text>

            <Section className="mt-[32px] mb-[42px] text-center">
              <Button
                className="text-primary border border-solid border-[#121212] bg-transparent px-6 py-3 text-center text-[14px] font-medium text-[#121212] no-underline"
                href={ndaSigningLink}
              >
                {t.button}
              </Button>
            </Section>

            <Text className="text-[14px] leading-[24px] break-all text-[#707070]">
              {t.copyPaste}{' '}
              <Link href={ndaSigningLink} className="text-[#707070] underline">
                {ndaSigningLink}
              </Link>
            </Text>

            <br />
            <Section>
              <Text className="text-[12px] leading-[24px] text-[#666666]">
                {t.expiryNote}
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

export default NdaSigningEmail;
