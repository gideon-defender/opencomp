/** Transport header is `apikey`; outbound API header remains `X-API-Key`.
 * Only local CLI callers should supply a static fallback. Hosted callers must not.
 */
export function resolveApiCredential({
  headers,
  staticApiKey,
  disableStaticAuth = false,
}: {
  headers: Headers;
  staticApiKey?: string;
  disableStaticAuth?: boolean;
}): string {
  const header = headers.get('apikey');
  if (header !== null) return header;
  return disableStaticAuth ? '' : (staticApiKey ?? '');
}
