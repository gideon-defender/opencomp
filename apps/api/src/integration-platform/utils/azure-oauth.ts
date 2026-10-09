import { BadRequestException } from '@nestjs/common';
import type { OAuthConfig } from '@gideon-defender/integration-platform';

const MICROSOFT_AUTHORITY = 'https://login.microsoftonline.com';
export const AZURE_DEFAULT_TOKEN_URL = `${MICROSOFT_AUTHORITY}/organizations/oauth2/v2.0/token`;
const TENANT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accept directory UUIDs only: settings must never control the token host/path. */
export function azureTenantId(customSettings: unknown): string {
  const value =
    customSettings &&
    typeof customSettings === 'object' &&
    'tenantId' in customSettings
      ? customSettings.tenantId
      : undefined;
  if (value === undefined || value === null || value === '')
    return 'organizations';
  if (typeof value !== 'string' || !TENANT_ID.test(value.trim())) {
    throw new BadRequestException(
      'Azure Directory (tenant) ID must be a UUID.',
    );
  }
  return value.trim().toLowerCase();
}

export function azureTokenUrl(tenantId: string): string {
  const tenant =
    tenantId === 'organizations' ? tenantId : azureTenantId({ tenantId });
  return `${MICROSOFT_AUTHORITY}/${tenant}/oauth2/v2.0/token`;
}

export function resolveAzureOAuthConfig(input: {
  providerSlug: string;
  config: OAuthConfig;
  customSettings?: unknown;
}): OAuthConfig {
  if (input.providerSlug !== 'azure') return input.config;
  const tenant = azureTenantId(input.customSettings);
  return {
    ...input.config,
    authorizeUrl: `${MICROSOFT_AUTHORITY}/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: azureTokenUrl(tenant),
  };
}
