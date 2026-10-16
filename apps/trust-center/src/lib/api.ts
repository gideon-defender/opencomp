import { apiBase, publicApiBase } from './api-config';
import { readNda } from './nda-api';

export { publicApiBase };

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

export type NdaStatus = 'pending' | 'signed' | 'expired' | 'void';

export type { NdaDetails } from './nda-api';

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

/**
 * Extract a user-facing message from an API error payload. Shared by the
 * trust-center forms so server validation text surfaces consistently.
 */
export function serverMessage(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
    if (Array.isArray(message)) {
      const first = message.find((item): item is string => typeof item === 'string');
      if (first) return first;
    }
  }
  return null;
}

/**
 * Browser-side POST against the public API base. The `trustApi` sign and
 * preview helpers run in client components, so they cannot use the
 * server-only `apiBase()` — and they surface the server message instead
 * of a generic failure so users see why a signature was rejected.
 */
async function postPublic<T>(path: string, body: Record<string, unknown>): Promise<T> {
  // Network and config failures stay generic: server validation text only
  // comes from parsed error responses, never from raw exceptions.
  let response: Response;
  try {
    response = await fetch(`${publicApiBase()}/v1/trust-access/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Trust API request failed: ${path}`);
  }
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(serverMessage(errorBody) ?? `Trust API request failed: ${path}`);
  }
  const data = await response.json().catch(() => null);
  if (data === null) {
    throw new Error(`Trust API request failed: ${path}`);
  }
  return data as T;
}

async function previewNda(token: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(
      `${publicApiBase()}/v1/trust-access/nda/${encodeURIComponent(token)}/preview-nda`,
      { cache: 'no-store', credentials: 'include', headers: { Accept: 'application/pdf' } },
    );
  } catch {
    throw new Error('Trust API request failed');
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(serverMessage(body) ?? 'Trust API request failed');
  }
  const pdf = await response.blob();
  if (pdf.type !== 'application/pdf' || pdf.size === 0) {
    throw new Error('Trust API request failed');
  }
  return pdf;
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
    get<{ faqs: PortalFaq[] | null }>(`${encodeURIComponent(id)}/faqs`).then((r) => r?.faqs ?? []),
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
  nda: readNda,
  signNda: (token: string, body: { name: string; email: string; accept: boolean }) =>
    postPublic<{ message: string; portalUrl: string }>(
      `nda/${encodeURIComponent(token)}/sign`,
      body,
    ),
  previewNda,
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
