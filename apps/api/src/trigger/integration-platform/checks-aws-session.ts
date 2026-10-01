import { logger } from '@gideon-defender/trigger-local';
import {
  CloudSecurityService,
  ConnectionNotFoundError,
} from '../../cloud-security/cloud-security.service';
import {
  getTriggerService,
  logTriggerAuditEntry,
  triggerHttpErrorMessage,
} from '../nest-context';
import type { IntegrationCredentialValues } from './ensure-valid-credentials';

/**
 * Credential keys injected by {@link injectAwsResolvedSession} and consumed by
 * the AWS manifest checks (`assumeAwsSession` in the integration-platform
 * package). Underscore-prefixed so they never collide with real AWS connection
 * credential fields (roleArn, externalId, regions, awsType, remediationRoleArn).
 */
export const RESOLVED_AWS_SESSION_KEYS = {
  accessKeyId: '__resolvedAccessKeyId',
  secretAccessKey: '__resolvedSecretAccessKey',
  sessionToken: '__resolvedSessionToken',
  error: '__resolvedSessionError',
} as const;

/**
 * For AWS connections, resolve the cross-account session via the API's
 * CloudSecurityService (which holds the roleAssumer task role +
 * `SECURITY_HUB_ROLE_ASSUMER_ARN`) and inject the resulting short-lived,
 * customer-scoped credentials into `credentials`.
 *
 * Why: the Cloud Tests CHECK path runs inside the Local trigger runtime, which has
 * no base AWS credentials or roleAssumer ARN, so it cannot perform the two-hop
 * assume itself. Resolving via the API service keeps the cross-tenant master
 * credential out of Local trigger; the check just consumes the temp creds.
 *
 * Runs in-process through the Nest container (workers share the API process),
 * not over HTTP — same service, no socket, no service token.
 *
 * On a genuine assume failure an error marker is injected so the AWS check
 * surfaces a real "Could not assume AWS role" finding with the true reason,
 * rather than silently failing or falsely passing. Non-AWS providers and
 * not-configured connections are left untouched.
 *
 * Mutates and returns the same credentials object.
 */
export async function injectAwsResolvedSession(params: {
  credentials: IntegrationCredentialValues;
  connectionId: string;
  organizationId: string;
  providerSlug: string;
}): Promise<IntegrationCredentialValues> {
  const { credentials, connectionId, organizationId, providerSlug } = params;

  if (providerSlug !== 'aws') return credentials;

  try {
    const service = getTriggerService(CloudSecurityService);
    const result = await service.resolveAwsSession(
      connectionId,
      organizationId,
    );

    // In-process calls skip the global AuditLogInterceptor — write the row
    // the resolve-session endpoint would have written (it logs any
    // non-thrown POST return, including ok:false results).
    await logTriggerAuditEntry({
      organizationId,
      resource: 'integration',
      method: 'POST',
      path: `/v1/cloud-security/resolve-session/${connectionId}`,
    });

    if (result.ok) {
      credentials[RESOLVED_AWS_SESSION_KEYS.accessKeyId] =
        result.session.accessKeyId;
      credentials[RESOLVED_AWS_SESSION_KEYS.secretAccessKey] =
        result.session.secretAccessKey;
      credentials[RESOLVED_AWS_SESSION_KEYS.sessionToken] =
        result.session.sessionToken;
      logger.info('Resolved AWS session via API service for connection', {
        connectionId,
      });
      return credentials;
    }

    if (result.reason === 'assume_failed') {
      credentials[RESOLVED_AWS_SESSION_KEYS.error] =
        result.error || 'The cross-account IAM role could not be assumed.';
    }
    // not_configured -> inject nothing; the check no-ops naturally.
    return credentials;
  } catch (error) {
    credentials[RESOLVED_AWS_SESSION_KEYS.error] =
      error instanceof ConnectionNotFoundError
        ? 'Could not resolve AWS session (connection not found).'
        : triggerHttpErrorMessage(error);
    return credentials;
  }
}
