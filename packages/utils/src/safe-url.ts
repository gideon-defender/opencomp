/**
 * Single shared copy of the outbound-URL safety rule.
 *
 * Stored URLs render as plain `<a href>` on the unauthenticated public
 * portal from org-controlled (and third-party-enriched) data — only
 * http(s) targets are safe.
 */
export function isSafeHttpUrl(value: string): boolean {
  try {
    const scheme = new URL(value).protocol.toLowerCase();
    return scheme === 'http:' || scheme === 'https:';
  } catch {
    return false;
  }
}

/**
 * Normalize a stored website into a safe outbound href. Bare domains gain
 * an `https://` prefix; values with a non-http(s) scheme (or that fail to
 * parse even with a prefix) return null so callers render plain text.
 */
export function toSafeExternalHref(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return isSafeHttpUrl(trimmed) ? trimmed : null;
  }
  const prefixed = `https://${trimmed}`;
  return isSafeHttpUrl(prefixed) ? prefixed : null;
}
