import { describe, expect, it } from 'vitest';
import { azureManifest } from '../index';

describe('Azure OAuth authority', () => {
  it('exposes an optional tenant setting in the existing admin form', () => {
    if (azureManifest.auth.type !== 'oauth2') throw new Error('Expected OAuth');
    expect(azureManifest.auth.config.additionalOAuthSettings).toContainEqual(
      expect.objectContaining({ id: 'tenantId', label: 'Directory (tenant) ID', required: false }),
    );
  });

  it('uses organizational accounts for authorization and token exchange', () => {
    const { auth } = azureManifest;
    expect(auth.type).toBe('oauth2');
    if (auth.type !== 'oauth2') throw new Error('Expected Azure OAuth configuration');

    expect(auth.config.authorizeUrl).toBe(
      'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
    );
    expect(auth.config.tokenUrl).toBe(
      'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
    );
  });
});
