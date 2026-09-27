import { HttpException } from '@nestjs/common';
import { getErrorCodeFromCause, translateKnownMessage } from './error-messages';
import { resolveLocale } from './locale';

type MutableExceptionState = {
  message: string;
  response: string | Record<string, unknown>;
};

function asMutableState(error: HttpException): MutableExceptionState | null {
  const state = error as unknown as Partial<MutableExceptionState>;
  if (typeof state.message !== 'string') return null;
  if (
    typeof state.response !== 'string' &&
    typeof state.response !== 'object'
  ) {
    return null;
  }
  return state as MutableExceptionState;
}

function translateMessageValue(
  value: unknown,
  translate: (message: string) => string,
): unknown {
  if (typeof value === 'string') return translate(value);
  if (Array.isArray(value)) {
    return value.map((entry) =>
      typeof entry === 'string' ? translate(entry) : entry,
    );
  }
  return value;
}

/**
 * Localize a thrown HttpException in place.
 *
 * Keeps the exception class, HTTP status, and response shape identical —
 * only the human-readable `message` text is translated. Unknown messages
 * pass through unchanged.
 */
export function localizeHttpException({
  error,
  acceptLanguage,
}: {
  error: HttpException;
  acceptLanguage: string | undefined | null;
}): HttpException {
  const locale = resolveLocale(acceptLanguage);
  if (locale === 'en') return error;

  // The cause carries the stable code; every message position on this
  // exception describes the same failure, so one code covers them all.
  const code = getErrorCodeFromCause(error);
  const translate = (message: string): string =>
    translateKnownMessage({ message, locale, code });

  const state = asMutableState(error);
  if (!state) return error;

  state.message = translate(state.message);

  if (typeof state.response === 'string') {
    state.response = translate(state.response);
    return error;
  }

  if (state.response !== null && 'message' in state.response) {
    state.response.message = translateMessageValue(
      state.response.message,
      translate,
    );
  }

  return error;
}
