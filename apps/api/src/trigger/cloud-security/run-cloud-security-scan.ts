import { db } from '@db';
import { logger, tags, task } from '@gideon-defender/trigger-local';
import { CloudSecurityController } from '../../cloud-security/cloud-security.controller';
import {
  createServiceTriggerRequest,
  getTriggerService,
  logTriggerAuditEntry,
  TRIGGER_SERVICE_NAME,
  triggerHttpErrorMessage,
} from '../nest-context';

/**
 * Trigger task that runs a cloud security scan for a single connection.
 * This is the worker task triggered by the scheduled orchestrator.
 *
 * Following the legacy pattern: catch all errors and return { success: false }
 * instead of throwing. This ensures errors are logged but don't cause noise.
 */
export const runCloudSecurityScan = task({
  id: 'run-cloud-security-scan',
  maxDuration: 1000 * 60 * 15, // 15 minutes (scans can take time for multiple regions)
  run: async (payload: {
    connectionId: string;
    organizationId: string;
    providerSlug: string;
    connectionName: string;
  }) => {
    const { connectionId, organizationId, providerSlug, connectionName } =
      payload;

    await tags.add([`org:${organizationId}`]);

    try {
      // Verify connection is still active and resolve provider (payload may use legacy "platform")
      const connection = await db.integrationConnection.findUnique({
        where: { id: connectionId },
        select: {
          id: true,
          status: true,
          provider: { select: { slug: true } },
        },
      });

      if (!connection) {
        logger.warn(`Connection not found: ${connectionId}`);
        return { success: false, error: 'Connection not found' };
      }

      if (connection.status !== 'active') {
        logger.info(`Skipping inactive connection: ${connectionId}`);
        return {
          success: true,
          skipped: true,
          reason: 'Connection not active',
        };
      }

      const resolvedProviderSlug = connection.provider?.slug ?? providerSlug;

      logger.info(
        `Starting cloud security scan for connection: ${connectionName}`,
        {
          connectionId,
          payloadProviderSlug: providerSlug,
          resolvedProviderSlug,
          organizationId,
        },
      );

      // In-process through the Nest container (workers share the API process) —
      // same handlers as the HTTP endpoints, no socket, no service token. The
      // synthesized service request keeps the scan's audit attribution
      // (`via service "Local trigger Workers"`, owner fallback) identical to
      // the HTTP path.
      const controller = getTriggerService(CloudSecurityController);
      const serviceReq = createServiceTriggerRequest({
        organizationId,
        serviceName: TRIGGER_SERVICE_NAME,
      });

      // Auto-detect services before scanning (AWS via Cost Explorer, GCP via Service Usage API)
      // Azure uses scan-based detection instead, so skip the pre-scan detect call
      if (resolvedProviderSlug === 'aws' || resolvedProviderSlug === 'gcp') {
        try {
          await controller.detectServices(connectionId, organizationId);
        } catch {
          // Non-critical — scan proceeds even if detect fails
        }
      }

      // Run the scan
      let result;
      try {
        result = await controller.scan(
          connectionId,
          organizationId,
          serviceReq,
        );
      } catch (error) {
        const errorMessage = triggerHttpErrorMessage(error);

        logger.warn(`Cloud security scan failed for ${connectionName}`, {
          connectionId,
          error: errorMessage,
        });

        return { success: false, error: errorMessage };
      }

      // In-process calls skip the global AuditLogInterceptor — write the row
      // it would have written so scheduled scans stay in the audit trail.
      // (The handler's own scan_completed row is written inside scan().)
      await logTriggerAuditEntry({
        organizationId,
        resource: 'integration',
        method: 'POST',
        path: `/v1/cloud-security/scan/${connectionId}`,
      });

      logger.info(`Cloud security scan completed for ${connectionName}`, {
        connectionId,
        provider: result.provider,
        findingsCount: result.findingsCount,
      });

      return {
        success: true,
        provider: result.provider,
        findingsCount: result.findingsCount,
        scannedAt: result.scannedAt,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error(`Error running cloud security scan for ${connectionName}`, {
        connectionId,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  },
});
