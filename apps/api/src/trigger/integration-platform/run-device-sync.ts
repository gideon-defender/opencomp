import { logger, tags, task } from '@gideon-defender/trigger-local';
import { SyncController } from '../../integration-platform/controllers/sync.controller';
import {
  getTriggerService,
  logTriggerAuditEntry,
  triggerHttpErrorMessage,
  triggerHttpErrorStatus,
} from '../nest-context';

/**
 * Local trigger task that runs device sync for a single org+connection.
 * Calls the sync handler in-process through the Nest container (workers share
 * the API process) — same handler as the HTTP endpoint, no socket, no
 * service token.
 *
 * Triggered by the daily integration-checks-schedule orchestrator.
 */
export const runDeviceSync = task({
  id: 'run-device-sync',
  maxDuration: 60 * 10, // 10 minutes — Local trigger maxDuration is in SECONDS
  run: async (payload: {
    organizationId: string;
    connectionId: string;
    providerSlug: string;
  }) => {
    const { organizationId, connectionId, providerSlug } = payload;

    await tags.add([`org:${organizationId}`]);

    logger.info(`Starting device sync for provider "${providerSlug}"`, {
      connectionId,
      organizationId,
    });

    try {
      const controller = getTriggerService(SyncController);
      const data = await controller.syncDynamicProviderDevices(
        organizationId,
        providerSlug,
        connectionId,
      );

      // In-process calls skip the global AuditLogInterceptor — write the row
      // it would have written so scheduled syncs stay in the audit trail.
      await logTriggerAuditEntry({
        organizationId,
        resource: 'integration',
        method: 'POST',
        path: `/v1/integrations/sync/dynamic/${providerSlug}/devices?connectionId=${connectionId}`,
      });

      const result = {
        success: data.success,
        totalFound: data.totalFound,
        imported: data.imported,
        updated: data.updated,
        removed: data.removed,
        skipped: data.skipped,
        errors: data.errors,
        syncRunId: data.syncRunId,
      };

      logger.info(`Device sync completed for "${providerSlug}"`, {
        imported: result.imported,
        updated: result.updated,
        removed: result.removed,
        skipped: result.skipped,
        errors: result.errors,
      });

      return result;
    } catch (error) {
      const errorMessage = `Device sync failed: ${triggerHttpErrorStatus(error)} - ${triggerHttpErrorMessage(error)}`;

      logger.error(`Device sync failed for "${providerSlug}"`, {
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  },
});
