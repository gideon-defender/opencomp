import { db } from '@db';
import type { Logger } from '@nestjs/common';
import { getManifest } from '@gideon-defender/integration-platform';
import type { CredentialVaultService } from '../integration-platform/services/credential-vault.service';
import type { OAuthCredentialsService } from '../integration-platform/services/oauth-credentials.service';
import type { AiRemediationService } from './ai-remediation.service';
import type { FindingContext } from './ai-remediation.service';
import type { AzureRemediationPlanCache } from './azure-remediation-plan-cache';
import type { AzureSecurityService } from './providers/azure-security.service';

/**
 * Service dependencies threaded through the Azure remediation flows.
 * Full service types (not Picks) so method `this`-contexts still check.
 */
export interface AzureRemediationServiceDeps {
  credentialVaultService: CredentialVaultService;
  oauthCredentialsService: OAuthCredentialsService;
  azureSecurityService: AzureSecurityService;
}

/** Everything a remediation flow needs: services, logger, plan cache. */
export interface AzureRemediationFlowDeps extends AzureRemediationServiceDeps {
  aiRemediationService: AiRemediationService;
  logger: Logger;
  planCache: AzureRemediationPlanCache;
}

export interface AzureRemediationContext {
  finding: FindingContext;
  accessToken: string | null;
  credentials: Record<string, unknown> | null;
}

/** Subscription id from a finding resource id (case-insensitive). */
export function extractSubscriptionId(resourceId: string): string | null {
  const match = resourceId.match(/\/subscriptions\/([^/]+)/i);
  return match?.[1] ?? null;
}

async function getValidAzureToken(
  deps: AzureRemediationServiceDeps,
  connectionId: string,
  organizationId: string,
): Promise<string | null> {
  const manifest = getManifest('azure');
  const oauthConfig =
    manifest?.auth?.type === 'oauth2' ? manifest.auth.config : null;

  if (oauthConfig) {
    const oauthCreds = await deps.oauthCredentialsService.getCredentials(
      'azure',
      organizationId,
    );
    if (oauthCreds) {
      const token = await deps.credentialVaultService.getValidAccessToken(
        connectionId,
        {
          tokenUrl: oauthConfig.tokenUrl,
          refreshUrl: oauthConfig.refreshUrl,
          clientId: oauthCreds.clientId,
          clientSecret: oauthCreds.clientSecret,
          clientAuthMethod: oauthConfig.clientAuthMethod,
          scope: oauthCreds.scopes.join(' '),
          tokenParams: oauthConfig.tokenParams,
        },
      );
      if (token) return token;
    }
  }

  // Fallback: try raw credentials (legacy SP or expired token)
  const credentials =
    await deps.credentialVaultService.getDecryptedCredentials(connectionId);
  if (!credentials) return null;

  if (credentials.access_token) {
    return credentials.access_token as string;
  }

  // Legacy service principal flow
  if (
    credentials.tenantId &&
    credentials.clientId &&
    credentials.clientSecret
  ) {
    return deps.azureSecurityService.getAccessToken(
      credentials.tenantId as string,
      credentials.clientId as string,
      credentials.clientSecret as string,
    );
  }

  return null;
}

/** Decrypted credentials for an active Azure connection, or null. */
export async function resolveAzureCredentials(
  deps: AzureRemediationServiceDeps,
  connectionId: string,
  organizationId: string,
): Promise<Record<string, unknown> | null> {
  const connection = await db.integrationConnection.findFirst({
    where: { id: connectionId, organizationId, status: 'active' },
    include: { provider: true },
  });
  if (!connection || connection.provider.slug !== 'azure') return null;
  return deps.credentialVaultService.getDecryptedCredentials(connectionId);
}

/**
 * Load the finding, auditor token, and decrypted credentials for a
 * connection plus check result. Throws when the connection or result
 * is missing — callers fail the run instead of acting on absent data.
 */
export async function resolveAzureContext(
  deps: AzureRemediationServiceDeps,
  connectionId: string,
  organizationId: string,
  checkResultId: string,
): Promise<AzureRemediationContext> {
  const connection = await db.integrationConnection.findFirst({
    where: { id: connectionId, organizationId, status: 'active' },
    include: { provider: true },
  });
  if (!connection || connection.provider.slug !== 'azure') {
    throw new Error('Azure connection not found or not active');
  }

  const accessToken = await getValidAzureToken(
    deps,
    connectionId,
    organizationId,
  );

  const checkResult = await db.integrationCheckResult.findFirst({
    where: {
      id: checkResultId,
      checkRun: { connectionId },
    },
  });

  if (!checkResult) {
    throw new Error(`Check result ${checkResultId} not found`);
  }

  const evidence = (checkResult.evidence ?? {}) as Record<string, unknown>;
  const credentials =
    await deps.credentialVaultService.getDecryptedCredentials(connectionId);

  return {
    finding: {
      title: checkResult.title ?? '',
      description: checkResult.description,
      severity: checkResult.severity,
      resourceType: checkResult.resourceType ?? 'azure-resource',
      resourceId: checkResult.resourceId ?? '',
      remediation: checkResult.remediation,
      findingKey: (evidence.findingKey as string) ?? '',
      evidence,
    },
    accessToken,
    credentials,
  };
}
