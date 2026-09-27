import {
  formatDateForLocale,
  localeFromAcceptLanguage,
  resolveEmailLocale,
} from './locale';

describe('resolveEmailLocale', () => {
  it('returns en for missing or unsupported input', () => {
    expect(resolveEmailLocale(undefined)).toBe('en');
    expect(resolveEmailLocale(null)).toBe('en');
    expect(resolveEmailLocale('')).toBe('en');
    expect(resolveEmailLocale('fr')).toBe('en');
    expect(resolveEmailLocale(42)).toBe('en');
  });

  it('normalizes supported locales with region and case variants', () => {
    expect(resolveEmailLocale('es')).toBe('es');
    expect(resolveEmailLocale('es-MX')).toBe('es');
    expect(resolveEmailLocale('es_MX')).toBe('es');
    expect(resolveEmailLocale('ES')).toBe('es');
    expect(resolveEmailLocale('en-US')).toBe('en');
  });
});

describe('localeFromAcceptLanguage', () => {
  it('returns en for missing headers', () => {
    expect(localeFromAcceptLanguage(undefined)).toBe('en');
    expect(localeFromAcceptLanguage('')).toBe('en');
  });

  it('picks the first supported language in header order', () => {
    expect(localeFromAcceptLanguage('es-MX,es;q=0.9,en;q=0.8')).toBe('es');
    expect(localeFromAcceptLanguage('en-US,en;q=0.9')).toBe('en');
    expect(localeFromAcceptLanguage('fr-FR,fr;q=0.9')).toBe('en');
    expect(localeFromAcceptLanguage('fr, es;q=0.5')).toBe('es');
  });

  it('honors q-values over header order', () => {
    expect(localeFromAcceptLanguage('en;q=0.1, es;q=0.9')).toBe('es');
    expect(localeFromAcceptLanguage('es;q=0, en;q=0.5')).toBe('en');
    expect(localeFromAcceptLanguage('fr;q=0.9, es;q=0.2')).toBe('es');
  });
});

describe('formatDateForLocale', () => {
  const date = new Date('2026-12-31T00:00:00Z');
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  };

  it('formats in US English for en', () => {
    expect(formatDateForLocale(date, 'en', options)).toBe(
      date.toLocaleDateString('en-US', options),
    );
  });

  it('formats in Spanish for es', () => {
    const formatted = formatDateForLocale(date, 'es', options);
    expect(formatted).toBe(date.toLocaleDateString('es-ES', options));
    expect(formatted).toContain('diciembre');
  });
});
