import type { HttpException } from '@nestjs/common';

/**
 * Supported locales for localized API error messages.
 */
export const SUPPORTED_LOCALES = ['en', 'es'] as const;

export type ErrorLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: ErrorLocale = 'en';

/**
 * Stable error codes. Each code maps to an { en, es } message pair.
 *
 * Throw sites attach the code with `withErrorCode(...)` so the interceptor
 * matches on the code, not on the English text. The `en` text stays the
 * message clients see by default and the fallback key for exceptions
 * thrown without a code (older call sites, third-party libs).
 */
export const ERROR_CODES = [
  'POLICY_NOT_FOUND',
  'API_KEY_SCOPE',
  'ACCESS_DENIED',
  'ONLY_CUSTOM_EDITABLE',
  'NO_FIELDS_TO_UPDATE',
  'CHECKR_CREDENTIALS_INVALID',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

type LocalizedMessage = Record<ErrorLocale, string>;

export const ERROR_MESSAGES: Record<ErrorCode, LocalizedMessage> = {
  POLICY_NOT_FOUND: {
    en: 'Policy not found',
    es: 'Política no encontrada',
  },
  API_KEY_SCOPE: {
    en: 'API key lacks required permission scope',
    es: 'La clave de API no tiene el ámbito de permiso requerido',
  },
  ACCESS_DENIED: {
    en: 'Access denied',
    es: 'Acceso denegado',
  },
  ONLY_CUSTOM_EDITABLE: {
    en: 'Only custom frameworks can be edited',
    es: 'Solo los marcos personalizados se pueden editar',
  },
  NO_FIELDS_TO_UPDATE: {
    en: 'No fields to update',
    es: 'No hay campos para actualizar',
  },
  CHECKR_CREDENTIALS_INVALID: {
    en: 'Checkr credentials are invalid.',
    es: 'Las credenciales de Checkr no son válidas.',
  },
};

/** Reverse lookup: English message text -> error code. */
const ENGLISH_TO_CODE: Record<string, ErrorCode> = (
  Object.entries(ERROR_MESSAGES) as Array<[ErrorCode, LocalizedMessage]>
).reduce(
  (acc, [code, messages]) => {
    acc[messages.en] = code;
    return acc;
  },
  {} as Record<string, ErrorCode>,
);

export function findErrorCodeByEnglishMessage(
  message: string,
): ErrorCode | undefined {
  return ENGLISH_TO_CODE[message];
}

/**
 * Attach a stable error code to a thrown exception via `cause`.
 *
 * `cause` never reaches the HTTP response — status, shape, and message
 * stay identical — so this is wire-safe. It survives `instanceof` checks
 * and `toThrow` assertions in existing tests.
 */
export function withErrorCode<TError extends HttpException>(
  error: TError,
  code: ErrorCode,
): TError {
  (error as unknown as { cause?: unknown }).cause = { code };
  return error;
}

/**
 * Read the code back. Returns undefined for foreign causes, so a
 * `{ cause: Error(...) }` chain from another lib never mistranslates.
 */
export function getErrorCodeFromCause(
  error: HttpException,
): ErrorCode | undefined {
  const cause = (error as unknown as { cause?: unknown }).cause;
  if (typeof cause !== 'object' || cause === null) return undefined;
  const code = (cause as { code?: unknown }).code;
  if (
    typeof code !== 'string' ||
    !(ERROR_CODES as readonly string[]).includes(code)
  ) {
    return undefined;
  }
  return code as ErrorCode;
}

export function translateErrorMessage({
  code,
  locale,
}: {
  code: ErrorCode;
  locale: ErrorLocale;
}): string {
  return ERROR_MESSAGES[code][locale];
}

/**
 * Translate a raw exception message to the target locale.
 *
 * Code-first: an explicit `code` (read from the exception's cause by the
 * caller) wins, so rewording the English text never drops a translation.
 * Without a code it falls back to English-text matching. Unknown messages
 * pass through unchanged (English default).
 */
export function translateKnownMessage({
  message,
  locale,
  code,
}: {
  message: string;
  locale: ErrorLocale;
  code?: ErrorCode;
}): string {
  if (locale === 'en') return message;
  const resolved = code ?? findErrorCodeByEnglishMessage(message);
  if (!resolved) return message;
  return ERROR_MESSAGES[resolved][locale];
}
