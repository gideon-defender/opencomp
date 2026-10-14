import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { db } from '@db';
import { SecretsService } from '../secrets/secrets.service';
import { CheckrIntakeClient } from './checkr-intake-client';
import type { ConfigureCheckrIntakeDto } from './dto/configure-checkr-intake.dto';

@Injectable()
export class CheckrIntakeConfigService {
  constructor(private readonly secrets: SecretsService) {}

  async client(params: { organizationId: string; connectionId?: string }) {
    const connection = await db.checkrIntakeConnection.findFirst({
      where: {
        organizationId: params.organizationId,
        ...(params.connectionId ? { id: params.connectionId } : {}),
      },
    });
    if (!connection?.enabled) {
      throw new ServiceUnavailableException(
        'Checkr candidate intake is not configured for this tenant.',
      );
    }
    const secret = await this.secrets.getSecret(
      connection.apiKeySecretId,
      params.organizationId,
    );
    const client = new CheckrIntakeClient({
      apiKey: secret.value,
      environment: connection.environment,
    });
    await client.verifyAccount(connection.accountId);
    return { connection, client };
  }

  async readiness(organizationId: string) {
    try {
      await this.client({ organizationId });
      return { ready: true };
    } catch {
      return {
        ready: false,
        message:
          'Ask an administrator to configure this tenant’s Checkr account and credentials.',
      };
    }
  }

  async configure(params: {
    organizationId: string;
    input: ConfigureCheckrIntakeDto;
  }) {
    const secret = await this.secrets.getSecret(
      params.input.apiKeySecretId,
      params.organizationId,
    );
    const client = new CheckrIntakeClient({
      apiKey: secret.value,
      environment: params.input.environment,
    });
    // Disabling intake must remain possible when vendor credentials expire.
    if (params.input.enabled)
      await client.verifyAccount(params.input.accountId);
    const existing = await db.checkrIntakeConnection.findUnique({
      where: { organizationId: params.organizationId },
    });
    if (
      existing &&
      (existing.accountId !== params.input.accountId ||
        existing.environment !== params.input.environment)
    ) {
      throw new BadRequestException(
        'Account replacement requires a reviewed migration; existing screening provenance must be preserved.',
      );
    }
    const select = {
      accountId: true,
      environment: true,
      package: true,
      node: true,
      enabled: true,
    } as const;
    const connection = existing
      ? await db.checkrIntakeConnection.update({
          where: { id: existing.id, organizationId: params.organizationId },
          data: {
            apiKeySecretId: params.input.apiKeySecretId,
            package: params.input.package,
            node: params.input.node ?? null,
            enabled: params.input.enabled,
          },
          select,
        })
      : await db.checkrIntakeConnection.create({
          data: { organizationId: params.organizationId, ...params.input },
          select,
        });
    return connection;
  }
}
