export function formatBytes(
  bytes: number,
  opts: {
    decimals?: number;
    sizeType?: 'accurate' | 'normal';
  } = {},
) {
  const { decimals = 0, sizeType = 'normal' } = opts;

  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const accurateSizes = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB'];
  if (bytes === 0) return '0 Byte';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(decimals)} ${
    sizeType === 'accurate' ? (accurateSizes[i] ?? 'Bytes') : (sizes[i] ?? 'Bytes')
  }`;
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Central date formatter — long month variant (e.g. "January 2, 2025").
 * Mirrors `apps/app/src/lib/format.ts:1` but handles null and invalid gracefully.
 * Returns '' for falsy/invalid input.
 */
export function formatDate(
  date: Date | string | number | null | undefined,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  const d = toDate(date);
  if (!d) return '';

  try {
    // If caller passes dateStyle/timeStyle, don't inject month/day/year defaults
    const hasStyle = 'dateStyle' in opts || 'timeStyle' in opts;
    const baseOpts: Intl.DateTimeFormatOptions = hasStyle
      ? { ...opts }
      : {
          month: opts.month ?? 'long',
          day: opts.day ?? 'numeric',
          year: opts.year ?? 'numeric',
          ...opts,
        };
    return new Intl.DateTimeFormat('en-US', baseOpts).format(d);
  } catch {
    return '';
  }
}

/**
 * Locale-default formatter (e.g. "1/2/2025" in en-US) — mirrors `new Date(v).toLocaleDateString()`
 * with no options. Returns '' for falsy/invalid.
 */
export function formatDateLocale(
  date: Date | string | number | null | undefined,
  locale?: string,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(date);
  if (!d) return '';
  try {
    return d.toLocaleDateString(locale, opts);
  } catch {
    return '';
  }
}

/**
 * Short month variant (e.g. "Jan 2, 2025") — the most common inline pattern.
 * Replaces ~15 inline `toLocaleDateString('en-US', { month:'short', ... })` copies.
 */
export function formatDateShort(
  date: Date | string | number | null | undefined,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  const d = toDate(date);
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      ...opts,
    }).format(d);
  } catch {
    return '';
  }
}

/**
 * Short date + time (e.g. "Jan 2, 2025, 3:45 PM").
 * Replaces `SyncHistorySection` and `TaskDetailSheet` inline variants.
 */
export function formatDateTime(
  date: Date | string | number | null | undefined,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  const d = toDate(date);
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      ...opts,
    }).format(d);
  } catch {
    return '';
  }
}

/**
 * ISO date `YYYY-MM-DD` — replaces 3 identical `formatDateYmd` helpers in
 * `apps/api/src/isms/*` and `monitoring-csv` / `MeasurementHistory`.
 * Returns `null` for falsy/invalid input to match API export expectations.
 * App callers needing a string fallback can do `formatDateYmd(x) ?? fallback`.
 */
export function formatDateYmd(date: Date | string | number | null | undefined): string | null {
  const d = toDate(date);
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * US numeric slash format `MM/dd/yyyy` — replaces `apps/app/src/lib/utils/format-date.ts:3`.
 * Returns '' for falsy/invalid input.
 */
export function formatDateSlash(date: Date | string | null | undefined): string {
  const d = toDate(date);
  if (!d) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * US numeric short slash with 2-digit year via `Intl` (portal variant: MM/dd/yyyy).
 * Alias for `formatDateSlash` for portal `PortalSubmissionsClient` (2-digit month/day).
 */
export function formatDateNumeric(date: Date | string | number | null | undefined): string {
  const d = toDate(date);
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    }).format(d);
  } catch {
    return '';
  }
}

type FormatAmountParams = {
  currency: string;
  amount: number;
  locale?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

export function formatAmount({
  currency,
  amount,
  locale = 'en-US',
  minimumFractionDigits,
  maximumFractionDigits,
}: FormatAmountParams) {
  if (!currency) {
    return;
  }

  return Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(amount);
}

/**
 * Avatar initials for a display name — canonical copy.
 * Mirrors `apps/app/src/lib/utils.ts:8` so every app renders the same
 * fallback. Takes the first character of the first two words
 * (unicode-safe), `'?'` for a blank name. Callers pass their own
 * fallback for nullish input, e.g. `getInitials(name ?? email ?? '')`.
 */
export function getInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toUpperCase())
    .join('');
  return initials || '?';
}
