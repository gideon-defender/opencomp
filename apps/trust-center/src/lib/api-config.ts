/**
 * Resolve the API base URL. Production fails closed: a silent localhost
 * default would ship dead download links and request forms to real users.
 * Localhost stays as a dev/test convenience only.
 */
function requiredApiBase(value: string | undefined, name: string): string {
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} is not set — trust-center links would point at localhost`);
  }
  return 'http://localhost:3333';
}

/** Server-side API base (SSR fetches). Resolved lazily so `next build`
 * does not throw when the runtime env is not present at build time. */
export function apiBase(): string {
  return requiredApiBase(
    process.env.TRUST_API_URL ?? process.env.BACKEND_API_URL,
    'TRUST_API_URL (or BACKEND_API_URL)',
  );
}

/** Browser-reachable API base for direct file-download links. */
export function publicApiBase(): string {
  return requiredApiBase(
    process.env.NEXT_PUBLIC_TRUST_API_URL ?? process.env.NEXT_PUBLIC_API_URL,
    'NEXT_PUBLIC_TRUST_API_URL (or NEXT_PUBLIC_API_URL)',
  );
}
