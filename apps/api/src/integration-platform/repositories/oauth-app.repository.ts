import { Injectable } from '@nestjs/common';
import { db, Prisma } from '@db';
import type { IntegrationOAuthApp } from '@db';

export type OAuthAppManagementSource = 'customer' | 'automation';

interface CreateOAuthAppDto {
  providerSlug: string;
  organizationId: string;
  encryptedClientId: object;
  encryptedClientSecret: object;
  customScopes?: string[];
  customSettings?: Prisma.InputJsonValue;
  managementSource?: OAuthAppManagementSource;
  automationVersion?: string | null;
  isActive?: boolean;
}

interface UpdateOAuthAppDto {
  encryptedClientId?: object;
  encryptedClientSecret?: object;
  customScopes?: string[];
  customSettings?: Prisma.InputJsonValue;
  isActive?: boolean;
  managementSource?: OAuthAppManagementSource;
  automationVersion?: string | null;
}

@Injectable()
export class OAuthAppRepository {
  async findByProviderAndOrg(
    providerSlug: string,
    organizationId: string,
  ): Promise<IntegrationOAuthApp | null> {
    return db.integrationOAuthApp.findUnique({
      where: {
        providerSlug_organizationId: {
          providerSlug,
          organizationId,
        },
      },
    });
  }

  async findActiveByProviderAndOrg(
    providerSlug: string,
    organizationId: string,
  ): Promise<IntegrationOAuthApp | null> {
    return db.integrationOAuthApp.findFirst({
      where: {
        providerSlug,
        organizationId,
        isActive: true,
      },
    });
  }

  async findByOrganization(
    organizationId: string,
  ): Promise<IntegrationOAuthApp[]> {
    return db.integrationOAuthApp.findMany({
      where: { organizationId },
      orderBy: { providerSlug: 'asc' },
    });
  }

  async create(data: CreateOAuthAppDto): Promise<IntegrationOAuthApp> {
    return db.integrationOAuthApp.create({
      data: {
        providerSlug: data.providerSlug,
        organizationId: data.organizationId,
        encryptedClientId: data.encryptedClientId,
        encryptedClientSecret: data.encryptedClientSecret,
        customScopes: data.customScopes || [],
        isActive: true,
      },
    });
  }

  async update(
    providerSlug: string,
    organizationId: string,
    data: UpdateOAuthAppDto,
  ): Promise<IntegrationOAuthApp> {
    return db.integrationOAuthApp.update({
      where: {
        providerSlug_organizationId: {
          providerSlug,
          organizationId,
        },
      },
      data: {
        encryptedClientId: data.encryptedClientId,
        encryptedClientSecret: data.encryptedClientSecret,
        customScopes: data.customScopes,
        customSettings: data.customSettings,
        isActive: data.isActive,
      },
    });
  }

  async upsert(data: CreateOAuthAppDto): Promise<IntegrationOAuthApp> {
    return db.integrationOAuthApp.upsert({
      where: {
        providerSlug_organizationId: {
          providerSlug: data.providerSlug,
          organizationId: data.organizationId,
        },
      },
      create: {
        providerSlug: data.providerSlug,
        organizationId: data.organizationId,
        encryptedClientId: data.encryptedClientId,
        encryptedClientSecret: data.encryptedClientSecret,
        customScopes: data.customScopes || [],
        customSettings: data.customSettings || undefined,
        managementSource: data.managementSource || 'customer',
        automationVersion: data.automationVersion ?? null,
        isActive: true,
      },
      update: {
        encryptedClientId: data.encryptedClientId,
        encryptedClientSecret: data.encryptedClientSecret,
        customScopes: data.customScopes || [],
        customSettings: data.customSettings || undefined,
        managementSource: data.managementSource || 'customer',
        automationVersion: data.automationVersion ?? null,
        isActive: true,
      },
    });
  }

  /**
   * Insert-if-absent for backfill/provisioning. Never overwrites an existing
   * row (a concurrent customer write wins). Returns whether this call created.
   */
  async createIfAbsent(
    data: CreateOAuthAppDto,
  ): Promise<{ created: boolean; row: IntegrationOAuthApp }> {
    try {
      const row = await db.integrationOAuthApp.create({
        data: {
          providerSlug: data.providerSlug,
          organizationId: data.organizationId,
          encryptedClientId: data.encryptedClientId,
          encryptedClientSecret: data.encryptedClientSecret,
          customScopes: data.customScopes || [],
          customSettings: data.customSettings || undefined,
          managementSource: data.managementSource || 'customer',
          automationVersion: data.automationVersion ?? null,
          isActive: data.isActive ?? true,
        },
      });
      return { created: true, row };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const row = await this.findByProviderAndOrg(
          data.providerSlug,
          data.organizationId,
        );
        if (!row) throw error;
        return { created: false, row };
      }
      throw error;
    }
  }

  /**
   * Conditional rotation primitive. Updates only an automation-owned row whose
   * version matches — customer-owned, missing, or stale rows match zero rows.
   * Preserves isActive: rotation never activates a disabled configuration.
   */
  async updateAutomationRow(args: {
    providerSlug: string;
    organizationId: string;
    expectedVersion: string;
    encryptedClientId: object;
    encryptedClientSecret: object;
    customScopes?: string[];
    customSettings?: Prisma.InputJsonValue;
    newVersion: string;
  }): Promise<number> {
    const { count } = await db.integrationOAuthApp.updateMany({
      where: {
        providerSlug: args.providerSlug,
        organizationId: args.organizationId,
        managementSource: 'automation',
        automationVersion: args.expectedVersion,
      },
      data: {
        encryptedClientId: args.encryptedClientId,
        encryptedClientSecret: args.encryptedClientSecret,
        customScopes: args.customScopes,
        customSettings: args.customSettings,
        automationVersion: args.newVersion,
      },
    });
    return count;
  }

  async findAutomationByProvider(
    providerSlug: string,
  ): Promise<IntegrationOAuthApp[]> {
    return db.integrationOAuthApp.findMany({
      where: { providerSlug, managementSource: 'automation' },
      orderBy: { organizationId: 'asc' },
    });
  }

  async delete(providerSlug: string, organizationId: string): Promise<void> {
    await db.integrationOAuthApp.delete({
      where: {
        providerSlug_organizationId: {
          providerSlug,
          organizationId,
        },
      },
    });
  }

  async setActive(
    providerSlug: string,
    organizationId: string,
    isActive: boolean,
  ): Promise<IntegrationOAuthApp> {
    return db.integrationOAuthApp.update({
      where: {
        providerSlug_organizationId: {
          providerSlug,
          organizationId,
        },
      },
      data: { isActive },
    });
  }
}
