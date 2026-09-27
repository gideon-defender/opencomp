import { localeFromAcceptLanguage } from '@gideon-defender/email/lib/locale';
import { routing } from './routing';

type Locale = (typeof routing)['locales'][number];

const locales: readonly string[] = routing.locales;

/**
 * Resolve the request locale: explicit cookie first, then the
 * Accept-Language header (q-value aware via the shared email locale
 * helper), then the default locale.
 */
export function resolveLocale({
  cookieLocale,
  acceptLanguage,
}: {
  cookieLocale: string | undefined;
  acceptLanguage: string | null;
}): Locale {
  if (cookieLocale && locales.includes(cookieLocale)) {
    return cookieLocale as Locale;
  }

  if (acceptLanguage) {
    const negotiated = localeFromAcceptLanguage(acceptLanguage);
    if (locales.includes(negotiated)) {
      return negotiated as Locale;
    }
  }

  return routing.defaultLocale;
}
