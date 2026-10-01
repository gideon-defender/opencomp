import { ConnectionsController } from '../../integration-platform/controllers/connections.controller';
import {
  getTriggerService,
  logTriggerAuditEntry,
  triggerHttpErrorMessage,
  triggerHttpErrorStatus,
} from '../nest-context';

export type IntegrationCredentialValues = Record<string, string | string[]>;

export interface ValidCredentialsResult {
  success: boolean;
  credentials?: IntegrationCredentialValues;
  error?: string;
  status?: number;
}

export function getAccessToken(
  credentials: IntegrationCredentialValues,
): string | undefined {
  const value = credentials.access_token;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export async function requestValidCredentials(params: {
  connectionId: string;
  organizationId: string;
  forceRefresh?: boolean;
}): Promise<ValidCredentialsResult> {
  try {
    // In-process through the Nest container (workers share the API process) —
    // same handler as the HTTP endpoint, no socket, no service token.
    const controller = getTriggerService(ConnectionsController);
    const result = await controller.ensureValidCredentials(
      params.connectionId,
      params.organizationId,
      { forceRefresh: params.forceRefresh === true },
    );

    // In-process calls skip the global AuditLogInterceptor — write the row
    // it would have written (it logs any non-thrown POST return).
    await logTriggerAuditEntry({
      organizationId: params.organizationId,
      resource: 'integration',
      method: 'POST',
      path: `/v1/integrations/connections/${params.connectionId}/ensure-valid-credentials`,
    });

    if (!result.success || !result.credentials) {
      return {
        success: false,
        error: 'Valid credentials response did not include credentials',
      };
    }

    return {
      success: true,
      credentials: result.credentials,
    };
  } catch (error) {
    return {
      success: false,
      status: triggerHttpErrorStatus(error),
      error: triggerHttpErrorMessage(error),
    };
  }
}
