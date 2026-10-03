import { HttpException, HttpStatus } from '@nestjs/common';
import { db } from '@db';
import { ACTIVE_BATCH_STATUSES } from './remediation-batch-status';

/** Bounded CAS retries before asking the caller to retry. */
const SKIP_FINDING_MAX_RETRIES = 3;

/**
 * Mark one finding cancelled so the running batch leaves it untouched.
 * Split out of `RemediationBatchService` to keep the service file under the
 * repo size limit — the HTTP layer still exposes this through the service.
 *
 * Compare-and-swap on the findings document: the worker's progress writes
 * land in the same JSON column, so a blind read-modify-write would clobber
 * them (and vice versa). On a lost race, re-read and retry against the fresh
 * document instead of writing stale state.
 */
export async function skipFindingInBatch(params: {
  batchId: string;
  findingId: string;
  organizationId: string;
}): Promise<{ success: true }> {
  const batch = await db.remediationBatch.findFirst({
    where: { id: params.batchId, organizationId: params.organizationId },
  });
  if (!batch) {
    throw new HttpException('Batch not found', HttpStatus.NOT_FOUND);
  }

  if (!Array.isArray(batch.findings)) {
    throw new HttpException(
      'Batch findings are corrupted',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
  if (batch.status !== undefined && !ACTIVE_BATCH_STATUSES.has(batch.status)) {
    throw new HttpException(
      `Cannot skip a finding in a "${batch.status}" batch`,
      HttpStatus.BAD_REQUEST,
    );
  }
  let findings = batch.findings as Array<{ id: string; status: string }>;
  const target = findings.find((f) => f.id === params.findingId);
  if (!target) {
    throw new HttpException('Finding not found in batch', HttpStatus.NOT_FOUND);
  }
  // Re-skipping an already-cancelled finding is idempotent — the end
  // state is what the caller asked for. Any other non-pending state
  // means the worker already handled it, so report that honestly
  // instead of a silent no-op success.
  if (target.status === 'cancelled') {
    return { success: true };
  }
  if (target.status !== 'pending') {
    throw new HttpException(
      `Finding "${params.findingId}" is already ${target.status} and cannot be skipped`,
      HttpStatus.CONFLICT,
    );
  }

  for (let attempt = 0; attempt < SKIP_FINDING_MAX_RETRIES; attempt += 1) {
    const updated = findings.map((f) =>
      f.id === params.findingId ? { ...f, status: 'cancelled' } : f,
    );

    // updateMany keeps the organization scope on the write — a plain
    // `update({ where: { id } })` would drop it. The status predicate
    // keeps a batch that finished mid-call from being rewritten, and
    // the findings predicate is the CAS guard.
    const result = await db.remediationBatch.updateMany({
      where: {
        id: params.batchId,
        organizationId: params.organizationId,
        status: { in: [...ACTIVE_BATCH_STATUSES] },
        findings: { equals: findings },
      },
      data: { findings: updated },
    });
    if (result.count === 1) {
      return { success: true };
    }

    const fresh = await db.remediationBatch.findFirst({
      where: { id: params.batchId, organizationId: params.organizationId },
    });
    if (!fresh) {
      throw new HttpException('Batch not found', HttpStatus.NOT_FOUND);
    }
    if (
      fresh.status !== undefined &&
      !ACTIVE_BATCH_STATUSES.has(fresh.status)
    ) {
      throw new HttpException(
        `Cannot skip a finding in a "${fresh.status}" batch`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!Array.isArray(fresh.findings)) {
      throw new HttpException(
        'Batch findings are corrupted',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    findings = fresh.findings as Array<{ id: string; status: string }>;
    const freshTarget = findings.find((f) => f.id === params.findingId);
    if (!freshTarget) {
      throw new HttpException(
        'Finding not found in batch',
        HttpStatus.NOT_FOUND,
      );
    }
    if (freshTarget.status === 'cancelled') {
      return { success: true };
    }
    if (freshTarget.status !== 'pending') {
      throw new HttpException(
        `Finding "${params.findingId}" is already ${freshTarget.status} and cannot be skipped`,
        HttpStatus.CONFLICT,
      );
    }
  }

  throw new HttpException(
    'Batch changed concurrently, please retry',
    HttpStatus.CONFLICT,
  );
}
