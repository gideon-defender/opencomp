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
import { Footer } from '../components/footer';
import { Logo } from '../components/logo';
import type { Locale } from '../lib/locale';

interface Props {
  currentEmail: string;
  newEmail: string;
  url: string;
  locale?: Locale;
}

const copy: Record<
  Locale,
  {
    preview: string;
    heading: string;
    button: string;
    copyPaste: string;
  }
> = {
  en: {
    preview: 'Confirm your email change for OpenComp',
    heading: 'Confirm your email change',
    button: 'Confirm email change',
    copyPaste: 'or copy and paste this URL into your browser',
  },
  es: {
    preview: 'Confirma tu cambio de correo electrónico para OpenComp',
    heading: 'Confirma tu cambio de correo electrónico',
    button: 'Confirmar cambio de correo',
    copyPaste: 'o copia y pega esta URL en tu navegador',
  },
};

export const ChangeEmailConfirmationEmail = ({
  currentEmail,
  newEmail,
  url,
  locale = 'en',
}: Props) => {
  const t = copy[locale];
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
                Solicitaste cambiar tu correo de acceso de OpenComp de{' '}
                <span className="font-medium">{currentEmail}</span> a{' '}
                <span className="font-medium">{newEmail}</span>. Confirma a continuación y luego
                sigue el enlace de verificación que enviaremos a tu nueva dirección para completar
                el cambio.
              </Text>
            ) : (
              <Text className="text-[14px] leading-[24px] text-[#121212]">
                You requested to change your OpenComp login email from{' '}
                <span className="font-medium">{currentEmail}</span> to{' '}
                <span className="font-medium">{newEmail}</span>. Confirm below, then follow the
                verification link we send to your new address to finish the change.
              </Text>
            )}
            <Section className="mt-[32px] mb-[42px] text-center">
              <Button
                className="text-primary border border-solid border-[#121212] bg-transparent px-6 py-3 text-center text-[14px] font-medium text-[#121212] no-underline"
                href={url}
              >
                {t.button}
              </Button>
            </Section>

            <Text className="text-[14px] leading-[24px] break-all text-[#707070]">
              {t.copyPaste}{' '}
              <Link href={url} className="text-[#707070] underline">
                {url}
              </Link>
            </Text>

            <br />
            <Section>
              <Text className="text-[12px] leading-[24px] text-[#666666]">
                {locale === 'es' ? (
                  <>
                    Si no solicitaste este cambio, puedes ignorar este correo de forma segura: tu
                    correo de acceso seguirá siendo{' '}
                    <span className="text-[#121212]">{currentEmail}</span>.
                  </>
                ) : (
                  <>
                    If you did not request this change, you can safely ignore this email — your
                    login email will stay <span className="text-[#121212]">{currentEmail}</span>.
                  </>
                )}
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

export default ChangeEmailConfirmationEmail;
