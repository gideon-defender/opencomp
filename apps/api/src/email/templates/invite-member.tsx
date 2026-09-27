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
  organizationName: string;
  inviteLink: string;
  email?: string;
  portalLink?: string;
  locale?: EmailLocale;
}

const copy = {
  en: {
    preview: "You've been invited to join OpenComp",
    joinPrefix: "Join",
    joinOn: "on",
    body: "You've been invited to join your team on",
    button: "Get started",
    copyPaste: "or copy and paste this URL into your browser",
    portalPrefix: "You also have access to the",
    portalSuffix:
      "Employee Portal for completing compliance tasks like signing policies and security training. Once you've accepted your invite above, you can access the portal at:",
    intendedFor: "this invitation was intended for",
  },
  es: {
    preview: "Te han invitado a unirte a OpenComp",
    joinPrefix: "Únete a",
    joinOn: "en",
    body: "Te han invitado a unirte a tu equipo en",
    button: "Comenzar",
    copyPaste: "o copia y pega esta URL en tu navegador",
    portalPrefix: "También tienes acceso al",
    portalSuffix:
      "Portal del Empleado para completar tareas de cumplimiento como firmar políticas y la formación en seguridad. Una vez que hayas aceptado tu invitación anterior, puedes acceder al portal en:",
    intendedFor: "esta invitación estaba destinada a",
  },
};

export const InviteEmail = ({
  organizationName,
  inviteLink,
  email,
  portalLink,
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
        <Preview>{t.preview}</Preview>

        <Body className="mx-auto my-auto bg-[#fff] font-sans">
          <Container
            className="mx-auto my-[40px] max-w-[600px] border-transparent p-[20px] md:border-[#E8E7E1]"
            style={{ borderStyle: 'solid', borderWidth: 1 }}
          >
            <Logo />
            <Heading className="mx-0 my-[30px] p-0 text-center text-[24px] font-normal text-[#121212]">
              {t.joinPrefix} <strong>{organizationName}</strong> {t.joinOn} <strong>OpenComp</strong>
            </Heading>

            <Text className="text-[14px] leading-[24px] text-[#121212]">
              {t.body} <strong>OpenComp</strong>.
            </Text>
            <Section className="mt-[32px] mb-[42px] text-center">
              <Button
                className="text-primary border border-solid border-[#121212] bg-transparent px-6 py-3 text-center text-[14px] font-medium text-[#121212] no-underline"
                href={inviteLink}
              >
                {t.button}
              </Button>
            </Section>

            <Text className="text-[14px] leading-[24px] break-all text-[#707070]">
              {t.copyPaste}{' '}
              <Link href={inviteLink} className="text-[#707070] underline">
                {inviteLink}
              </Link>
            </Text>

            {portalLink && (
              <>
                <Text className="text-[14px] leading-[24px] text-[#121212] mt-[24px]">
                  {t.portalPrefix} <strong>{organizationName}</strong> {t.portalSuffix}
                </Text>
                <Text className="text-[14px] leading-[24px] break-all text-[#707070]">
                  <Link href={portalLink} className="text-[#707070] underline">
                    {portalLink}
                  </Link>
                </Text>
              </>
            )}

            <br />
            {email && (
              <Section>
                <Text className="text-[12px] leading-[24px] text-[#666666]">
                  {t.intendedFor}{' '}
                  <span className="text-[#121212]">{email}</span>.
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
