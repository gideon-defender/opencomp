import {
  azureTenantId,
  azureTokenUrl,
  resolveAzureOAuthConfig,
} from './azure-oauth';
import type { OAuthConfig } from '@gideon-defender/integration-platform';

const tenant = '55639f13-71b7-432d-b4e7-4efda934446d';
const config: OAuthConfig = {
  authorizeUrl:
    'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
  scopes: ['openid'],
  pkce: false,
  clientAuthMethod: 'body',
  supportsRefreshToken: true,
};

describe('Azure OAuth directory routing', () => {
  it('uses the same validated directory for authorization and exchange', () => {
    const resolved = resolveAzureOAuthConfig({
      providerSlug: 'azure',
      config,
      customSettings: { tenantId: ` ${tenant.toUpperCase()} ` },
    });
    expect(resolved.authorizeUrl).toBe(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    );
    expect(resolved.tokenUrl).toBe(azureTokenUrl(tenant));
    expect(config.authorizeUrl).toContain('/organizations/');
  });
  it.each([undefined, null, {}, { tenantId: '' }])(
    'preserves the default for %p',
    (customSettings) => {
      expect(azureTenantId(customSettings)).toBe('organizations');
    },
  );
  it.each([
    'https://evil.test',
    '../consumers',
    'common',
    'consumers',
    'organizations',
    `${tenant}?x=y`,
    `${tenant}/token`,
    ' ',
    123,
    ['tenant'],
  ])('rejects invalid directory %p', (tenantId) => {
    expect(() => azureTenantId({ tenantId })).toThrow('must be a UUID');
  });
  it('does not alter other providers', () => {
    expect(
      resolveAzureOAuthConfig({
        providerSlug: 'gcp',
        config,
        customSettings: { tenantId: 'invalid' },
      }),
    ).toBe(config);
  });
});
