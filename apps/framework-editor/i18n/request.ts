import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { getMessagesForLocale } from './messages';
import { resolveLocale } from './resolve-locale';

export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get('NEXT_LOCALE')?.value;
  const acceptLanguage = (await headers()).get('accept-language');
  const locale = resolveLocale({ cookieLocale, acceptLanguage });

  return {
    locale,
    messages: getMessagesForLocale(locale),
  };
});
