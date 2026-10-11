import { Logger } from '@nestjs/common';
import type { OAuthConfig } from '@gideon-defender/integration-platform';
import { z } from 'zod';
import { githubAppSlug } from '../utils/github-app-oauth';
import type { PlatformCredentialRepository } from '../repositories/platform-credential.repository';
import type { CredentialVaultService } from './credential-vault.service';
import type { OAuthCredentials } from './oauth-credentials.service';

const logger = new Logger('SharedOAuth');
const encryptedData = z.object({
  encrypted: z.string(),
  iv: z.string(),
  tag: z.string(),
  salt: z.string(),
});

export function isSharedOAuthProvider(providerSlug: string): boolean {
  return [
    'gcp',
    'azure',
    'github-app',
    'github',
    'aikido',
    'google-workspace',
    'rippling',
    'vercel',
  ].includes(providerSlug);
}

/** Shared app identity only. Customer grants and tokens stay in org connections. */
export async function getSharedOAuthCredentials({
  providerSlug,
  oauthConfig,
  repository,
  vault,
}: {
  providerSlug: string;
  oauthConfig: OAuthConfig;
  repository: PlatformCredentialRepository;
  vault: CredentialVaultService;
}): Promise<OAuthCredentials | null> {
  if (!isSharedOAuthProvider(providerSlug)) return null;
  const app = await repository.findActiveByProviderSlug(providerSlug);
  if (!app?.isActive) return null;
  try {
    const clientId = await vault.decrypt(
      encryptedData.parse(app.encryptedClientId),
    );
    const clientSecret = await vault.decrypt(
      encryptedData.parse(app.encryptedClientSecret),
    );
    if (!clientId || !clientSecret) return null;
    const customSettings = z
      .record(z.string(), z.unknown())
      .parse(app.customSettings ?? {});
    // A shared app's home directory is not the customer's directory. Azure
    // uses /organizations; explicit directory pins remain on org overrides.
    if (providerSlug === 'azure') delete customSettings.tenantId;
    if (providerSlug === 'github-app')
      customSettings.githubAppSlug = githubAppSlug.parse(
        customSettings.githubAppSlug,
      );
    for (const setting of oauthConfig.additionalOAuthSettings ?? []) {
      if (!setting.required) continue;
      customSettings[setting.id] = z
        .string()
        .trim()
        .min(1)
        .parse(customSettings[setting.id]);
    }
    return {
      clientId,
      clientSecret,
      source: 'platform',
      scopes: app.customScopes.length ? app.customScopes : oauthConfig.scopes,
      customSettings,
    };
  } catch {
    logger.error(
      `Shared ${providerSlug} OAuth app credentials are invalid or cannot be decrypted`,
    );
    return null;
  }
}
