import { describe, expect, it } from 'vitest';
import { resolveLocale } from './resolve-locale';

describe('resolveLocale', () => {
  it('prefers a valid cookie over the header', () => {
    expect(resolveLocale({ cookieLocale: 'es', acceptLanguage: 'en-US,en;q=0.9' })).toBe('es');
    expect(resolveLocale({ cookieLocale: 'en', acceptLanguage: 'es-ES,es;q=0.9' })).toBe('en');
  });

  it('honors q-value ordering instead of header order', () => {
    expect(resolveLocale({ cookieLocale: undefined, acceptLanguage: 'en;q=0.8, es;q=0.9' })).toBe(
      'es',
    );
    expect(resolveLocale({ cookieLocale: undefined, acceptLanguage: 'es;q=0.2, en;q=0.9' })).toBe(
      'en',
    );
  });

  it('refuses languages with q=0', () => {
    expect(resolveLocale({ cookieLocale: undefined, acceptLanguage: 'es;q=0' })).toBe('en');
    expect(resolveLocale({ cookieLocale: undefined, acceptLanguage: 'es;q=0, en;q=0.5' })).toBe(
      'en',
    );
  });

  it('skips unsupported languages and matches on the language base', () => {
    expect(resolveLocale({ cookieLocale: undefined, acceptLanguage: 'fr, es;q=0.9' })).toBe('es');
    expect(resolveLocale({ cookieLocale: undefined, acceptLanguage: 'es-MX' })).toBe('es');
    expect(resolveLocale({ cookieLocale: undefined, acceptLanguage: 'ES-mx' })).toBe('es');
  });

  it('falls back to en for wildcards, unknown, missing, or empty headers', () => {
    expect(resolveLocale({ cookieLocale: undefined, acceptLanguage: '*' })).toBe('en');
    expect(resolveLocale({ cookieLocale: undefined, acceptLanguage: 'fr' })).toBe('en');
    expect(resolveLocale({ cookieLocale: undefined, acceptLanguage: null })).toBe('en');
    expect(resolveLocale({ cookieLocale: undefined, acceptLanguage: '' })).toBe('en');
  });

  it('ignores an invalid cookie and falls through to the header', () => {
    expect(resolveLocale({ cookieLocale: 'fr', acceptLanguage: 'es' })).toBe('es');
    expect(resolveLocale({ cookieLocale: 'fr', acceptLanguage: null })).toBe('en');
  });
});
