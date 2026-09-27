import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'es'],
  defaultLocale: 'en',
  // Locale is resolved from the user preference cookie / Accept-Language, not
  // from the URL. The editor keeps its existing route tree untouched.
  localePrefix: 'never',
});
