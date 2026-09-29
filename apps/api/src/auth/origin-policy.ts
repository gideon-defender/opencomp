const DEFAULT_TRUSTED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3002',
  'http://localhost:3333',
  'http://localhost:3004',
  'http://localhost:3008',
  // Internal compose service name. The app/portal containers call better-auth
  // server-to-server with BACKEND_API_URL=http://api:3333, and app
  // server code injects that URL as the Origin header (CSRF). Without this
  // entry those calls fail origin validation (e.g. organization/set-active),
  // leaving sessions without an active org so org-scoped API calls 401.
  'http://api:3333',
  'https://app.gideondefender.com',
  'https://portal.gideondefender.com',
  'https://api.gideondefender.com',
  'https://app.staging.gideondefender.com',
  'https://portal.staging.gideondefender.com',
  'https://api.staging.gideondefender.com',
  'https://dev.gideondefender.com',
  'https://framework-editor.gideondefender.com',
];

const COMP_EXTENSION_ALLOWED_ROUTES = [
  { method: 'GET', path: '/api/auth/get-session' },
  { method: 'GET', path: '/v1/auth/me' },
  { method: 'POST', path: '/api/auth/organization/set-active' },
  { method: 'POST', path: '/v1/questionnaire/answer-single' },
];

function parseOriginList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function normalizePath(path: string): string {
  if (path.length <= 1) return path;
  return path.replace(/\/+$/, '');
}

export function getTrustedOrigins(): string[] {
  const origins = parseOriginList(process.env.AUTH_TRUSTED_ORIGINS);
  return origins.length > 0 ? origins : [...DEFAULT_TRUSTED_ORIGINS];
}

export function getCompExtensionTrustedOrigins(): string[] {
  return parseOriginList(process.env.COMP_EXTENSION_TRUSTED_ORIGINS);
}

export function getBetterAuthTrustedOrigins(): string[] {
  return [...getTrustedOrigins(), ...getCompExtensionTrustedOrigins()];
}

export function isCompExtensionOrigin(origin: string): boolean {
  return getCompExtensionTrustedOrigins().includes(origin);
}

export function isChromeExtensionOrigin(origin: string): boolean {
  try {
    return new URL(origin).protocol === 'chrome-extension:';
  } catch {
    return false;
  }
}

export function isCompExtensionAllowedRoute(params: {
  method: string;
  path: string;
}): boolean {
  const method = params.method.toUpperCase();
  const path = normalizePath(params.path);
  return COMP_EXTENSION_ALLOWED_ROUTES.some(
    (route) => route.method === method && route.path === path,
  );
}

export function isCompExtensionOriginAllowedForRequest(params: {
  method: string;
  origin: string;
  path: string;
}): boolean {
  return (
    isCompExtensionOrigin(params.origin) &&
    isCompExtensionAllowedRoute({ method: params.method, path: params.path })
  );
}

export function isStaticTrustedOrigin(origin: string): boolean {
  const trustedOrigins = getTrustedOrigins();
  if (trustedOrigins.includes(origin)) {
    return true;
  }

  try {
    const url = new URL(origin);
    // Only the explicit DEFAULT_TRUSTED_ORIGINS entries above may be plain
    // HTTP (localhost). The wildcard suffix match is HTTPS-only.
    if (url.protocol !== 'https:') return false;
    return (
      url.hostname.endsWith('.gideondefender.com') ||
      url.hostname.endsWith('.staging.gideondefender.com')
    );
  } catch {
    return false;
  }
}

export function isStaticTrustedOriginForRequest(params: {
  method: string;
  origin: string;
  path: string;
}): boolean {
  return (
    isStaticTrustedOrigin(params.origin) ||
    isCompExtensionOriginAllowedForRequest(params)
  );
}
