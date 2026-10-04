'use client';

import { api } from '@/lib/api-client';
import { useCallback } from 'react';
import { useIntegrationMutations } from './use-integration-platform';

interface AwsTwoStepConnectOptions {
  providerId: string;
  orgId: string;
}

interface Phase1Fields {
  [key: string]: string | string[];
}

interface Phase1Result {
  success: boolean;
  id?: string;
  externalId?: string;
  error?: string;
}

interface CompleteParams {
  pendingId: string;
  credentials: Record<string, string | string[]>;
}

/** Derive the default connection name from a Role ARN (`AWS <accountId>`). */
export function defaultAwsConnectionName(roleArn: unknown): string {
  const arnMatch = String(roleArn ?? '').match(/:(\d{12}):/);
  return arnMatch ? `AWS ${arnMatch[1]}` : 'AWS Account';
}

/**
 * Shape phase-2 credentials: the server owns the External ID (mints on
 * create, pins on update), so a lingering client value must never be sent.
 * The deprecated single remediation role is rejected for new connections
 * (400 on create), so it must never travel either — pairs go in the
 * `remediationRoles` map, which passes through untouched.
 * Defaults the connection name from the Role ARN when absent.
 */
export function buildAwsPhase2Credentials(
  credentials: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const finalCredentials = { ...credentials };
  delete finalCredentials.externalId;
  delete finalCredentials.remediationRoleArn;
  if (!finalCredentials.connectionName) {
    finalCredentials.connectionName = defaultAwsConnectionName(finalCredentials.roleArn);
  }
  return finalCredentials;
}

/**
 * Shared AWS two-step connect: phase 1 mints the pending connection
 * (server-issued External ID), phase 2 validates the Role ARN against it
 * and activates. The connect dialog and the empty-state onboarding run the
 * same flow — keep it here so the next fix lands in one place.
 *
 * Phase 1 posts directly instead of via `createConnection` because that
 * hook invalidates the connections cache, which would unmount the flow
 * mid-step. Callers pass provider-specific extras (e.g. `awsScanMode`)
 * through `fields`.
 */
export function useAwsTwoStepConnect({ providerId, orgId }: AwsTwoStepConnectOptions): {
  startPendingConnection: (params: { fields: Phase1Fields }) => Promise<Phase1Result>;
  completePendingConnection: (params: CompleteParams) => Promise<{
    success: boolean;
    error?: string;
    notFound?: boolean;
  }>;
} {
  const { updateConnectionCredentials } = useIntegrationMutations();

  const startPendingConnection = useCallback(
    async ({ fields }: { fields: Phase1Fields }): Promise<Phase1Result> => {
      if (!orgId) {
        return { success: false, error: 'No organization selected' };
      }
      try {
        const response = await api.post<{
          id: string;
          status?: string;
          externalId?: string;
        }>('/v1/integrations/connections', {
          providerSlug: providerId,
          organizationId: orgId,
          credentials: fields,
        });
        if (response.error || !response.data?.id || !response.data?.externalId) {
          return {
            success: false,
            error: response.error || 'Failed to start connection',
          };
        }
        return {
          success: true,
          id: response.data.id,
          externalId: response.data.externalId,
        };
      } catch {
        return { success: false, error: 'Failed to start connection' };
      }
    },
    [providerId, orgId],
  );

  const completePendingConnection = useCallback(
    async ({ pendingId, credentials }: CompleteParams) => {
      const update = await updateConnectionCredentials(pendingId, credentials);
      if (update.success) {
        return { success: true as const };
      }
      return {
        success: false as const,
        error: update.error,
        // The pending row is gone (deleted, expired, or another tab's
        // abandoned flow). Callers clear the stored value on this flag so
        // the user returns to phase 1 instead of retrying a dead ID.
        notFound: /not found/i.test(update.error ?? ''),
      };
    },
    [updateConnectionCredentials],
  );

  return { startPendingConnection, completePendingConnection };
}
