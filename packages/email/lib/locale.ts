export type Locale = 'en' | 'es';

const SUPPORTED: readonly Locale[] = ['en', 'es'];

/**
 * Normalize free-form input (user/org preference, query param, message
 * field) to a supported email locale. Falls back to 'en'.
 */
export function resolveLocale(input: unknown): Locale {
  if (typeof input !== 'string') return 'en';
  const base = input.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED.includes(base as Locale) ? (base as Locale) : 'en';
}

interface LanguageRange {
  tag: string;
  quality: number;
  index: number;
}

/**
 * Parse an Accept-Language header into ranges sorted by q-value
 * (highest first, header order breaks ties). Ranges with q=0, wildcards,
 * and empty tags are dropped — the caller falls back to 'en' for those.
 */
function parseLanguageRanges(header: string): LanguageRange[] {
  return header
    .split(',')
    .map((part, index) => {
      const [tagPart, ...params] = part.split(';');
      let quality = 1;
      for (const param of params) {
        const [key, value] = param.split('=');
        if (key?.trim().toLowerCase() === 'q') {
          const parsed = Number.parseFloat((value ?? '').trim());
          if (!Number.isNaN(parsed)) quality = parsed;
        }
      }
      return { tag: (tagPart ?? '').trim().toLowerCase(), quality, index };
    })
    .filter((range) => range.tag.length > 0 && range.tag !== '*' && range.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
}

/**
 * Pick a locale from an Accept-Language header value. Uses the highest
 * priority (q-value) supported language, falling back to 'en'.
 *
 * Explicit `en` ranges terminate the scan: `en` is itself a supported
 * language, so `en, es` means English, not "skip English and take Spanish".
 * Only ranges that match no supported language are skipped.
 */
export function localeFromAcceptLanguage(header: unknown): Locale {
  if (typeof header !== 'string' || header.length === 0) return 'en';
  for (const range of parseLanguageRanges(header)) {
    const base = range.tag.split(/[-_]/)[0] ?? '';
    if (base === 'en') return 'en';
    const locale = resolveLocale(range.tag);
    if (locale !== 'en') return locale;
  }
  return 'en';
}

/**
 * Format a date the way templates previously did with `toLocaleDateString`,
 * but honoring the recipient locale instead of hard-coding `en-US`.
 */
export function formatDateForLocale(
  date: Date,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (locale === 'es') return date.toLocaleDateString('es-ES', options);
  return date.toLocaleDateString('en-US', options);
}
