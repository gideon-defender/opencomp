import { localeFromAcceptLanguage } from '@gideon-defender/email';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type ErrorLocale,
} from './error-messages';

function isSupportedLocale(value: string): value is ErrorLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Resolve the response locale from an Accept-Language header value.
 *
 * Delegates to the shared `@gideon-defender/email` parser (q-value aware,
 * base-tag matching, `*` skipped), then narrows to the error-message
 * locale set. Missing header or no supported match falls back to `en`.
 */
export function resolveLocale(
  acceptLanguage: string | undefined | null,
): ErrorLocale {
  const locale = localeFromAcceptLanguage(acceptLanguage ?? undefined);
  if (isSupportedLocale(locale)) return locale;
  return DEFAULT_LOCALE;
}
