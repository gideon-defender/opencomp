import { HttpException, HttpStatus } from '@nestjs/common';
import { db } from '@db';
import { classifyTerminalUpdate } from './remediation-batch-status';

interface TerminalOutcomeParams {
  batchId: string;
  organizationId: string;
  status?: string;
  triggerRunId?: string;
  currentStatus: unknown;
  currentTriggerRunId: unknown;
}

/**
 * Shared terminal-batch outcome for the pre-check path and the lost-race
 * path in `RemediationBatchService.updateBatch`. Both callers must behave
 * identically: refuse rewrites, normalize the legacy `done` alias, and
 * treat idempotent resends as success. Kept here so the service stays
 * under the 300-line limit.
 */
export async function resolveTerminalOutcome(
  params: TerminalOutcomeParams,
): Promise<{ data: unknown }> {
  const decision = classifyTerminalUpdate({
    status: params.status,
    triggerRunId: params.triggerRunId,
    currentStatus: params.currentStatus,
    currentTriggerRunId: params.currentTriggerRunId,
  });
  if (decision === 'refuse') {
    throw new HttpException(
      `Cannot update a "${params.currentStatus}" batch`,
      HttpStatus.BAD_REQUEST,
    );
  }
  if (decision === 'normalize-completed') {
    // Normalize the legacy `done` alias, pinned to observed state.
    await db.remediationBatch.updateMany({
      where: {
        id: params.batchId,
        organizationId: params.organizationId,
        status: params.currentStatus as string,
      },
      data: { status: params.status },
    });
  }
  const batch = await db.remediationBatch.findFirst({
    where: { id: params.batchId, organizationId: params.organizationId },
  });
  return { data: batch };
}
