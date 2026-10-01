/**
 * Resolve the API base URL. Production fails closed: a silent localhost
 * default would ship dead download links and request forms to real users.
 * Localhost stays as a dev/test convenience only.
 */
function requiredApiBase(value: string | undefined, name: string): string {
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${name} is not set — trust-center links would point at localhost`,
    );
  }
  return 'http://localhost:3333';
}

/** Server-side API base (SSR fetches). Resolved lazily so `next build`
 * does not throw when the runtime env is not present at build time. */
function apiBase(): string {
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

export { FRAMEWORK_TITLES } from '@gideon-defender/utils';

export type FrameworkStatus = 'started' | 'in_progress' | 'compliant';

export interface PortalProfile {
  organizationName: string;
  domain: string | null;
  domainVerified: boolean;
  friendlyUrl: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  contactEmail: string | null;
}

export interface PortalFramework {
  key: string;
  title: string;
  status: FrameworkStatus;
  hasCertificate: boolean;
}

export interface PortalPolicy {
  id: string;
  name: string;
  updatedAt: string;
}

export interface PortalControl {
  id: string;
  name: string;
}

export interface PortalVendorBadge {
  type: string;
  label: string;
}

export interface PortalVendor {
  id: string;
  name: string;
  description: string | null;
  website: string | null;
  logoUrl: string | null;
  complianceBadges: PortalVendorBadge[] | null;
  trustPortalUrl: string | null;
}

export interface PortalFaq {
  question: string;
  answer: string;
  order: number;
}

export interface PortalCustomLink {
  id: string;
  title: string;
  description: string | null;
  url: string;
}

export interface PortalOverview {
  title: string | null;
  content: string | null;
}

export interface PortalCustomFramework {
  id: string;
  name: string;
  description: string;
  status: FrameworkStatus;
  hasCertificate: boolean;
  badgeUrl: string | null;
}

export interface GrantInfo {
  organizationName: string;
  friendlyUrl: string;
  faviconUrl: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  securityQuestionnaireEnabled: boolean;
  expiresAt: string;
  subjectEmail: string;
  ndaPdfUrl: string | null;
}

export interface GrantPolicy {
  id: string;
  name: string;
  description: string | null;
}

export interface GrantResource {
  framework?: string | null;
  customFrameworkId?: string | null;
  fileName: string;
  fileSize: number;
  updatedAt: string;
}

export interface GrantDocument {
  id: string;
  name: string;
  description: string | null;
}

async function get<T>(path: string): Promise<T | null> {
  const response = await fetch(`${apiBase()}/v1/trust-access/${path}`, {
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Trust API request failed: ${path}`);
  }
  return (await response.json()) as T;
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${apiBase()}/v1/trust-access/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Trust API request failed: ${path}`);
  }
  return (await response.json()) as T;
}

export const trustApi = {
  profile: (id: string) => get<PortalProfile>(`${encodeURIComponent(id)}/profile`),
  frameworks: (id: string) =>
    get<PortalFramework[]>(`${encodeURIComponent(id)}/frameworks`).then((r) => r ?? []),
  policies: (id: string) =>
    get<PortalPolicy[]>(`${encodeURIComponent(id)}/policies`).then((r) => r ?? []),
  controls: (id: string) =>
    get<PortalControl[]>(`${encodeURIComponent(id)}/controls`).then((r) => r ?? []),
  vendors: (id: string) =>
    get<PortalVendor[]>(`${encodeURIComponent(id)}/vendors`).then((r) => r ?? []),
  faqs: (id: string) =>
    get<{ faqs: PortalFaq[] | null }>(`${encodeURIComponent(id)}/faqs`).then(
      (r) => r?.faqs ?? [],
    ),
  overview: (id: string) => get<PortalOverview>(`${encodeURIComponent(id)}/overview`),
  customLinks: (id: string) =>
    get<PortalCustomLink[]>(`${encodeURIComponent(id)}/custom-links`).then((r) => r ?? []),
  customFrameworks: (id: string) =>
    get<PortalCustomFramework[]>(`${encodeURIComponent(id)}/custom-frameworks`).then(
      (r) => r ?? [],
    ),
  questionnaireEnabled: (id: string) =>
    get<{ enabled: boolean }>(`${encodeURIComponent(id)}/security-questionnaire`).then(
      (r) => r?.enabled ?? true,
    ),
  grant: (token: string) => get<GrantInfo>(`access/${encodeURIComponent(token)}`),
  grantPolicies: (token: string) =>
    get<GrantPolicy[]>(`access/${encodeURIComponent(token)}/policies`).then((r) => r ?? []),
  grantResources: (token: string) =>
    get<GrantResource[]>(`access/${encodeURIComponent(token)}/compliance-resources`).then(
      (r) => r ?? [],
    ),
  grantDocuments: (token: string) =>
    get<GrantDocument[]>(`access/${encodeURIComponent(token)}/documents`).then((r) => r ?? []),
  requestAccess: (id: string, body: Record<string, unknown>) =>
    post(`${encodeURIComponent(id)}/requests`, body),
};

/** Public host shown on the page: verified custom domain, else the shared host. */
export function displayHost({
  domain,
  domainVerified,
  friendlyUrl,
}: {
  domain: string | null;
  domainVerified: boolean;
  friendlyUrl: string | null;
}): string {
  if (domain && domainVerified) return domain;
  return `trust.gideondefender.com/${friendlyUrl ?? ''}`;
}

export function statusLabel(status: FrameworkStatus): string {
  if (status === 'compliant') return 'Compliant';
  if (status === 'in_progress') return 'In Progress';
  return 'Started';
}

import { upgradeFaviconUrl } from '@gideon-defender/utils';

export { upgradeFaviconUrl };
