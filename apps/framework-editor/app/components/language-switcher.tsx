'use client';

import { Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

const LOCALE_COOKIE = 'NEXT_LOCALE';
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const LOCALES = [
  { value: 'en', label: 'EN' },
  { value: 'es', label: 'ES' },
] as const;

type Locale = (typeof LOCALES)[number]['value'];

function setLocaleCookie(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
}

function LanguageSwitcher({ size = 'sm' }: { size?: 'sm' | 'default' }) {
  const locale = useLocale();
  const t = useTranslations('shell');
  const iconSize = size === 'sm' ? 'size-3' : 'size-3.5';
  const buttonSize = size === 'sm' ? 'size-6 text-[11px]' : 'size-7 text-xs';

  const handleChange = (nextLocale: Locale) => {
    if (nextLocale === locale) {
      return;
    }
    setLocaleCookie(nextLocale);
    window.location.reload();
  };

  return (
    <div
      data-slot="language-switcher"
      role="radiogroup"
      aria-label={t('language')}
      className="inline-flex items-center rounded-full bg-muted p-0.5"
    >
      <Languages className={`${iconSize} mr-0.5 text-muted-foreground`} aria-hidden="true" />
      {LOCALES.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={locale === option.value}
          aria-label={option.value === 'en' ? t('english') : t('spanish')}
          onClick={() => handleChange(option.value)}
          className={`inline-flex items-center justify-center rounded-full font-medium transition-all duration-200 ${
            locale === option.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          } ${buttonSize}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export { LanguageSwitcher };
