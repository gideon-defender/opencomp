import enMessages from '../../public/_locales/en/messages.json';

export type MessageKey = keyof typeof enMessages;

interface ChromeI18n {
  getMessage(key: string, substitutions?: string | string[]): string;
}

function getChromeI18n(): ChromeI18n | null {
  const chromeGlobal = globalThis as unknown as { chrome?: { i18n?: ChromeI18n } };
  const i18n = chromeGlobal.chrome?.i18n;
  if (!i18n || typeof i18n.getMessage !== 'function') return null;
  return i18n;
}

function applySubstitutions(message: string, substitutions?: string | string[]): string {
  if (substitutions === undefined) return message;
  const list = Array.isArray(substitutions) ? substitutions : [substitutions];
  let result = message;
  list.forEach((value, index) => {
    result = result.replaceAll(`$${index + 1}`, value);
  });
  return result;
}

function fallbackMessage(key: MessageKey, substitutions?: string | string[]): string {
  const entry = enMessages[key] as { message?: string } | undefined;
  const message = typeof entry?.message === 'string' ? entry.message : key;
  return applySubstitutions(message, substitutions);
}

/** Typed wrapper around chrome.i18n.getMessage with English fallback. */
export function t(key: MessageKey, substitutions?: string | string[]): string {
  const i18n = getChromeI18n();
  if (!i18n) return fallbackMessage(key, substitutions);
  try {
    const message = i18n.getMessage(key, substitutions);
    if (message) return message;
  } catch {
    // Fall through to the bundled English fallback.
  }
  return fallbackMessage(key, substitutions);
}
