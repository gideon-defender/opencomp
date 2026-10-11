import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OAuthAppRepository } from '../repositories/oauth-app.repository';
import { PlatformCredentialRepository } from '../repositories/platform-credential.repository';
import { CredentialVaultService } from './credential-vault.service';
import type { EncryptedData } from './credential-vault.service';
import type { IntegrationOAuthApp, Prisma } from '@db';

export type BackfillStatus =
  | 'copied'
  | 'already-present'
  | 'no-platform-source'
  | 'source-inactive'
  | 'source-undecryptable';

export interface BackfillResult {
  status: BackfillStatus;
  providerSlug: string;
  organizationId: string;
  rowId?: string;
}

interface BackfillArgs {
  providerSlug: string;
  organizationId: string;
  automationVersion: string;
}

interface RotateArgs {
  providerSlug: string;
  organizationId: string;
  expectedVersion: string;
  newVersion: string;
  clientId: string;
  clientSecret: string;
  customScopes?: string[];
  customSettings?: Prisma.InputJsonValue;
}

interface ProvisionArgs {
  organizationId: string;
  automationVersion: string;
  providerSlugs?: string[];
}

/**
 * Phase 0 (remove-cross-tenant-roles): automation-owned credential lifecycle.
 * Backfill copies active platform credentials into missing org rows with
 * automation provenance; rotation only touches version-matching automation
 * rows; customer writes (via OAuthCredentialsService.saveOrgCredentials) take
 * ownership back. No log line contains credentials — only slugs, orgs,
 * versions, and outcomes.
 */
@Injectable()
export class AutomationCredentialService {
  private readonly logger = new Logger(AutomationCredentialService.name);

  constructor(
    private readonly oauthAppRepository: OAuthAppRepository,
    private readonly platformCredentialRepository: PlatformCredentialRepository,
    private readonly credentialVaultService: CredentialVaultService,
  ) {}

  async backfillOrgCredentials(
    args: BackfillArgs,
  ): Promise<BackfillResult> {
    const { providerSlug, organizationId, automationVersion } = args;
    const existing = await this.oauthAppRepository.findByProviderAndOrg(
      providerSlug,
      organizationId,
    );
    if (existing) {
      return {
        status: 'already-present',
        providerSlug,
        organizationId,
        rowId: existing.id,
      };
    }

    const platform =
      await this.platformCredentialRepository.findByProviderSlug(
        providerSlug,
      );
    if (!platform) {
      return { status: 'no-platform-source', providerSlug, organizationId };
    }
    if (!platform.isActive) {
      this.logger.warn(
        `Backfill skipped disabled platform source ${providerSlug} for org ${organizationId}`,
      );
      return { status: 'source-inactive', providerSlug, organizationId };
    }

    try {
      await this.credentialVaultService.decrypt(
        platform.encryptedClientId as unknown as EncryptedData,
      );
      await this.credentialVaultService.decrypt(
        platform.encryptedClientSecret as unknown as EncryptedData,
      );
    } catch {
      this.logger.error(
        `Backfill skipped undecryptable platform source ${providerSlug} for org ${organizationId}`,
      );
      return { status: 'source-undecryptable', providerSlug, organizationId };
    }

    const { created, row } = await this.oauthAppRepository.createIfAbsent({
      providerSlug,
      organizationId,
      encryptedClientId: platform.encryptedClientId as object,
      encryptedClientSecret: platform.encryptedClientSecret as object,
      customScopes: platform.customScopes,
      customSettings:
        (platform.customSettings as Prisma.InputJsonValue) ?? undefined,
      managementSource: 'automation',
      automationVersion,
      isActive: platform.isActive,
    });
    this.logger.log(
      `Backfill ${providerSlug} for org ${organizationId}: ${created ? 'copied' : 'already-present'} version ${automationVersion}`,
    );
    return {
      status: created ? 'copied' : 'already-present',
      providerSlug,
      organizationId,
      rowId: row.id,
    };
  }

  async provisionOrgCredentials(
    args: ProvisionArgs,
  ): Promise<{ organizationId: string; results: BackfillResult[] }> {
    const { organizationId, automationVersion } = args;
    const slugs =
      args.providerSlugs ??
      (await this.platformCredentialRepository.findAll())
        .filter((row) => row.isActive)
        .map((row) => row.providerSlug);
    const results: BackfillResult[] = [];
    for (const providerSlug of slugs) {
      results.push(
        await this.backfillOrgCredentials({
          providerSlug,
          organizationId,
          automationVersion,
        }),
      );
    }
    const copied = results.filter((r) => r.status === 'copied').length;
    this.logger.log(
      `Provisioned org ${organizationId}: ${copied} copied, ${results.length - copied} skipped of ${results.length}`,
    );
    return { organizationId, results };
  }

  async rotateAutomationCredentials(
    args: RotateArgs,
  ): Promise<IntegrationOAuthApp> {
    const { providerSlug, organizationId, expectedVersion, newVersion } = args;
    const existing = await this.oauthAppRepository.findByProviderAndOrg(
      providerSlug,
      organizationId,
    );
    if (!existing) {
      throw new NotFoundException(
        `No OAuth app for ${providerSlug} in org ${organizationId}`,
      );
    }
    if (existing.managementSource !== 'automation') {
      throw new ForbiddenException(
        `OAuth app for ${providerSlug} in org ${organizationId} is customer-owned; rotation skipped`,
      );
    }
    if (existing.automationVersion !== expectedVersion) {
      throw new ConflictException(
        `Stale automation version for ${providerSlug} in org ${organizationId}`,
      );
    }

    const encryptedClientId =
      await this.credentialVaultService.encrypt(args.clientId);
    const encryptedClientSecret =
      await this.credentialVaultService.encrypt(args.clientSecret);
    const updated = await this.oauthAppRepository.updateAutomationRow({
      providerSlug,
      organizationId,
      expectedVersion,
      encryptedClientId,
      encryptedClientSecret,
      customScopes: args.customScopes,
      customSettings: args.customSettings,
      newVersion,
    });
    if (updated !== 1) {
      throw new ConflictException(
        `Rotation lost a concurrent write for ${providerSlug} in org ${organizationId}`,
      );
    }
    const row = await this.oauthAppRepository.findByProviderAndOrg(
      providerSlug,
      organizationId,
    );
    this.logger.log(
      `Rotated ${providerSlug} for org ${organizationId}: ${expectedVersion} -> ${newVersion}`,
    );
    if (!row) throw new NotFoundException('OAuth app vanished during rotation');
    return row;
  }

  async rotateProviderCredentials(args: {
    providerSlug: string;
    expectedVersion: string;
    newVersion: string;
    clientId: string;
    clientSecret: string;
  }): Promise<{ updated: string[]; skipped: { organizationId: string; reason: string }[] }> {
    const rows = await this.oauthAppRepository.findAutomationByProvider(
      args.providerSlug,
    );
    const updated: string[] = [];
    const skipped: { organizationId: string; reason: string }[] = [];
    for (const row of rows) {
      if (row.automationVersion !== args.expectedVersion) {
        skipped.push({ organizationId: row.organizationId, reason: 'stale' });
        continue;
      }
      try {
        await this.rotateAutomationCredentials({
          ...args,
          organizationId: row.organizationId,
        });
        updated.push(row.organizationId);
      } catch (error) {
        skipped.push({
          organizationId: row.organizationId,
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
    this.logger.log(
      `Provider rotation ${args.providerSlug}: ${updated.length} updated, ${skipped.length} skipped`,
    );
    return { updated, skipped };
  }
}
