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
import { isSharedOAuthProvider } from './shared-oauth';

export type BackfillStatus =
  | 'shared-app'
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

  async backfillOrgCredentials(args: BackfillArgs): Promise<BackfillResult> {
    const { providerSlug, organizationId, automationVersion } = args;
    if (isSharedOAuthProvider(providerSlug)) {
      return { status: 'shared-app', providerSlug, organizationId };
    }
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
      await this.platformCredentialRepository.findByProviderSlug(providerSlug);
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

    const encryptedClientId = await this.credentialVaultService.encrypt(
      args.clientId,
    );
    const encryptedClientSecret = await this.credentialVaultService.encrypt(
      args.clientSecret,
    );
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
    const row = await this.readCommittedRow({ providerSlug, organizationId });
    this.logger.log(
      `Rotated ${providerSlug} for org ${organizationId}: ${expectedVersion} -> ${newVersion}`,
    );
    return row;
  }

  /** Re-read committed rotations; never return a pre-write row as current.
   * Missing rows get bounded retries, then an explicit conflict. */
  private async readCommittedRow({
    providerSlug,
    organizationId,
  }: {
    providerSlug: string;
    organizationId: string;
  }): Promise<IntegrationOAuthApp> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const row = await this.oauthAppRepository.findByProviderAndOrg(
        providerSlug,
        organizationId,
      );
      if (row) return row;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
      }
    }
    throw new ConflictException(
      `Rotation for ${providerSlug} in org ${organizationId} committed but the row is unreadable afterwards (concurrent delete or read failure) — re-read before trusting the new version`,
    );
  }

  async rotateProviderCredentials(args: {
    providerSlug: string;
    expectedVersion: string;
    newVersion: string;
    clientId: string;
    clientSecret: string;
  }): Promise<{
    updated: string[];
    skipped: { organizationId: string; reason: string }[];
  }> {
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
      // Bounded retries on transient failures only, with linear backoff.
      // Deterministic outcomes (missing/customer-owned/stale) never retry.
      // Retries are idempotent: the conditional update matches at most one
      // versioned row. Unknown errors retry too — they are usually vault/DB
      // blips — but at most 3 attempts with a growing delay, never a hot loop.
      let outcome: string | null = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await this.rotateAutomationCredentials({
            ...args,
            organizationId: row.organizationId,
          });
          outcome = null;
          break;
        } catch (error) {
          if (
            error instanceof NotFoundException ||
            error instanceof ForbiddenException ||
            error instanceof ConflictException
          ) {
            outcome = error.message;
            break;
          }
          outcome = error instanceof Error ? error.message : 'unknown';
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
          }
        }
      }
      if (outcome === null) {
        updated.push(row.organizationId);
      } else {
        skipped.push({ organizationId: row.organizationId, reason: outcome });
      }
    }
    this.logger.log(
      `Provider rotation ${args.providerSlug}: ${updated.length} updated, ${skipped.length} skipped`,
    );
    return { updated, skipped };
  }
}
