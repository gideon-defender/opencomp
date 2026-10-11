import { Injectable, Logger } from '@nestjs/common';
import { OAuthAppRepository } from '../repositories/oauth-app.repository';
import {
  CredentialVaultService,
  EncryptedData,
} from './credential-vault.service';
import {
  getManifest,
  type OAuthConfig,
} from '@gideon-defender/integration-platform';
import type { Prisma } from '@db';

import { azureTenantId } from '../utils/azure-oauth';

interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  /** Where the credentials came from */
  source: 'organization' | 'platform';
  /** Provider-specific custom settings (e.g., Rippling app name) */
  customSettings?: Record<string, unknown>;
}

interface OAuthCredentialsAvailability {
  /** Whether credentials are available (from any source) */
  available: boolean;
  /** Whether org has custom credentials configured */
  hasOrgCredentials: boolean;
  /** Whether platform has credentials configured */
  hasPlatformCredentials: boolean;
  /** Instructions for setting up custom OAuth app (if no credentials available) */
  setupInstructions?: string;
  /** URL to create OAuth app */
  createAppUrl?: string;
}

@Injectable()
export class OAuthCredentialsService {
  private readonly logger = new Logger(OAuthCredentialsService.name);

  constructor(
    private readonly oauthAppRepository: OAuthAppRepository,
    private readonly credentialVaultService: CredentialVaultService,
  ) {}

  /**
   * Get OAuth credentials for a provider — org-level only. There is no
   * platform fallback: missing org credentials fail closed (Phase 1).
   * The legacy platform store remains readable for backfill/rotation via
   * AutomationCredentialService until the Release B contract migration.
   */
  async getCredentials(
    providerSlug: string,
    organizationId: string,
  ): Promise<OAuthCredentials | null> {
    const manifest = getManifest(providerSlug);
    if (!manifest || manifest.auth.type !== 'oauth2') {
      return null;
    }

    return this.getOrgCredentials(
      providerSlug,
      organizationId,
      manifest.auth.config,
    );
  }

  /**
   * Check what credentials are available for a provider
   */
  async checkAvailability(
    providerSlug: string,
    organizationId: string,
  ): Promise<OAuthCredentialsAvailability> {
    const manifest = getManifest(providerSlug);
    if (!manifest || manifest.auth.type !== 'oauth2') {
      return {
        available: false,
        hasOrgCredentials: false,
        hasPlatformCredentials: false,
      };
    }

    const oauthConfig = manifest.auth.config;

    // Check org credentials
    const orgApp = await this.oauthAppRepository.findActiveByProviderAndOrg(
      providerSlug,
      organizationId,
    );
    const hasOrgCredentials = !!orgApp;

    // No platform fallback (Phase 1). The field stays during compatibility
    // for older clients; it is always false.
    return {
      available: hasOrgCredentials,
      hasOrgCredentials,
      hasPlatformCredentials: false,
      setupInstructions: oauthConfig.setupInstructions,
      createAppUrl: oauthConfig.createAppUrl,
    };
  }

  /**
   * Save custom OAuth app credentials for an organization
   */
  async saveOrgCredentials(
    providerSlug: string,
    organizationId: string,
    clientId: string,
    clientSecret: string,
    customScopes?: string[],
    customSettings?: Prisma.InputJsonValue,
  ): Promise<void> {
    if (providerSlug === 'azure') azureTenantId(customSettings);
    const encryptedClientId =
      await this.credentialVaultService.encrypt(clientId);
    const encryptedClientSecret =
      await this.credentialVaultService.encrypt(clientSecret);

    await this.oauthAppRepository.upsert({
      providerSlug,
      organizationId,
      encryptedClientId,
      encryptedClientSecret,
      customScopes,
      customSettings: customSettings,
      // A customer write takes ownership back from automation: rotation must
      // never overwrite it afterwards (see AutomationCredentialService).
      managementSource: 'customer',
      automationVersion: null,
    });

    this.logger.log(
      `Saved custom OAuth credentials for ${providerSlug}, org: ${organizationId}`,
    );
  }

  /**
   * Delete custom OAuth app credentials for an organization
   */
  async deleteOrgCredentials(
    providerSlug: string,
    organizationId: string,
  ): Promise<void> {
    await this.oauthAppRepository.delete(providerSlug, organizationId);
    this.logger.log(
      `Deleted custom OAuth credentials for ${providerSlug}, org: ${organizationId}`,
    );
  }

  /**
   * Get org-level OAuth credentials
   */
  private async getOrgCredentials(
    providerSlug: string,
    organizationId: string,
    oauthConfig: OAuthConfig,
  ): Promise<OAuthCredentials | null> {
    const orgApp = await this.oauthAppRepository.findActiveByProviderAndOrg(
      providerSlug,
      organizationId,
    );

    if (!orgApp) {
      return null;
    }

    try {
      const clientId = await this.credentialVaultService.decrypt(
        orgApp.encryptedClientId as unknown as EncryptedData,
      );
      const clientSecret = await this.credentialVaultService.decrypt(
        orgApp.encryptedClientSecret as unknown as EncryptedData,
      );

      // Use custom scopes if provided, otherwise fall back to manifest defaults
      const scopes =
        orgApp.customScopes.length > 0
          ? orgApp.customScopes
          : oauthConfig.scopes;

      return {
        clientId,
        clientSecret,
        scopes,
        source: 'organization',
        customSettings:
          (orgApp.customSettings as Record<string, unknown>) || undefined,
      };
    } catch (error) {
      this.logger.error(`Failed to decrypt org OAuth credentials: ${error}`);
      return null;
    }
  }
}
