import { vi } from 'vitest';

/**
 * Mocks next-intl so components can render in jsdom without a real
 * NextIntlClientProvider / request config. `useTranslations` returns a
 * translator that resolves every key to the key itself (e.g. `t('title')`
 * -> `'title'`), so tests can assert on the translated output with the key.
 *
 * Call `mockNextIntl()` at the top of a test module before importing the
 * component under test.
 */
const { useLocale } = vi.hoisted(() => ({ useLocale: vi.fn(() => 'en') }));

vi.mock('next-intl', () => ({
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  useLocale,
  useMessages: () => ({}),
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: (date: Date) => date.toISOString(),
    date: (date: Date) => date.toISOString(),
    number: (value: number) => String(value),
    list: (items: string[]) => items.join(', '),
  }),
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => 'en',
  getMessages: async () => ({}),
  getTimeZone: async () => 'UTC',
}));

export function mockNextIntl() {
  return { useLocale };
}
