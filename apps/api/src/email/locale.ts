/**
 * Locale support for the API's own email templates
 * (`apps/api/src/email/templates/*`).
 *
 * Canonical implementation lives in `@gideon-defender/email`
 * (`packages/email/lib/locale.ts`) — import from there in new code.
 * This module re-exports it under the API's `EmailLocale` naming so the
 * existing notifier services keep working unchanged.
 *
 * Intentional default: no user/org language preference exists in the DB
 * yet, so notifier callers omit `locale` and recipients get English.
 * When a preference ships, resolve it per recipient inside the notifier
 * send loops — a single call can fan out to many recipients, so one
 * `params.locale` cannot cover them.
 */
export {
  formatDateForLocale,
  localeFromAcceptLanguage,
  resolveLocale as resolveEmailLocale,
  type Locale as EmailLocale,
} from '@gideon-defender/email';
