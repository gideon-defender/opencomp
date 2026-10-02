import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { db, Prisma } from '@db';

type CreatedRemediationBatch = Awaited<
  ReturnType<typeof db.remediationBatch.create>
>;

/** A batch only accepts skips while it is still in progress. */
const ACTIVE_BATCH_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'running',
]);

/** Terminal batch states — a batch here never accepts more work. */
const TERMINAL_BATCH_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'done',
  'failed',
  'cancelled',
]);

/** Bounded CAS retries for skipFinding before asking the caller to retry. */
const SKIP_FINDING_MAX_RETRIES = 3;

interface BatchFindingInput {
  id: string;
  key: string;
  title: string;
}

/**
 * One-active-batch lifecycle: create, update, skip, and lookup scoped by
 * organization. Extracted from RemediationController so batch orchestration
 * lives behind the service layer instead of raw `db` calls in HTTP handlers.
 *
 * The one-active-batch invariant has two layers: a friendly pre-check read
 * plus the partial unique index
 * (`RemediationBatch_one_active_per_connection`) as the race arbiter. Two
 * concurrent creates can both pass the read — the loser fails the insert
 * with P2002, which maps to the same 409 instead of orphaning a batch.
 */
@Injectable()
export class RemediationBatchService {
  async getActiveBatch(params: {
    connectionId: string;
    organizationId: string;
  }): Promise<{ data: unknown }> {
    if (!params.connectionId) {
      throw new HttpException(
        'connectionId query parameter is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const batch = await db.remediationBatch.findFirst({
      where: {
        connectionId: params.connectionId,
        organizationId: params.organizationId,
        status: { in: [...ACTIVE_BATCH_STATUSES] },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { data: batch };
  }

  async createBatch(params: {
    connectionId: string;
    findings: BatchFindingInput[];
    organizationId: string;
    userId: string;
  }): Promise<{ data: CreatedRemediationBatch }> {
    // The connection must belong to this organization — never create batch
    // work against another org's connection.
    const connection = await db.integrationConnection.findFirst({
      where: {
        id: params.connectionId,
        organizationId: params.organizationId,
        status: 'active',
      },
    });
    if (!connection) {
      throw new HttpException(
        'Connection not found or inactive',
        HttpStatus.NOT_FOUND,
      );
    }
    if (params.findings.length === 0) {
      throw new HttpException(
        'At least one finding is required to start a batch',
        HttpStatus.BAD_REQUEST,
      );
    }
    const seenFindingIds = new Set<string>();
    const findings = params.findings.map((f) => {
      const id = f.id.trim();
      const key = f.key.trim();
      if (!id || !key) {
        throw new HttpException(
          'Each finding must have a non-empty id and key',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (seenFindingIds.has(id)) {
        throw new HttpException(
          `Duplicate finding id in batch: ${id}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      seenFindingIds.add(id);
      return {
        id,
        key,
        title: f.title,
        status: 'pending',
      };
    });

    // One active batch per connection — a second create while one is
    // pending/running would orphan the first (its triggerRunId never lands).
    const activeBatch = await db.remediationBatch.findFirst({
      where: {
        connectionId: params.connectionId,
        organizationId: params.organizationId,
        status: { in: [...ACTIVE_BATCH_STATUSES] },
      },
      select: { id: true },
    });
    if (activeBatch) {
      throw new HttpException(
        'A batch is already active for this connection',
        HttpStatus.CONFLICT,
      );
    }

    // The read above is only a friendly fast path. Two concurrent creates
    // can both pass it — the partial unique index
    // (RemediationBatch_one_active_per_connection) rejects the loser with
    // P2002, which maps to the same 409 instead of orphaning a batch.
    try {
      const batch = await db.remediationBatch.create({
        data: {
          connectionId: params.connectionId,
          organizationId: params.organizationId,
          initiatedById: params.userId,
          status: 'pending',
          findings,
        },
      });
      return { data: batch };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new HttpException(
          'A batch is already active for this connection',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async updateBatch(params: {
    batchId: string;
    triggerRunId?: string;
    status?: string;
    organizationId: string;
  }): Promise<{ data: unknown }> {
    // updateMany keeps the organization scope on the write itself —
    // Prisma `update` only accepts a unique filter, so `update` with
    // `{ id, organizationId }` throws on every call.
    if (!params.triggerRunId && !params.status) {
      throw new HttpException(
        'Nothing to update: provide triggerRunId or status',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (params.status) {
      const existing = await db.remediationBatch.findFirst({
        where: { id: params.batchId, organizationId: params.organizationId },
        select: { status: true },
      });
      if (!existing) {
        throw new HttpException('Batch not found', HttpStatus.NOT_FOUND);
      }
      const reopening =
        params.status === 'pending' || params.status === 'running';
      if (
        existing.status !== undefined &&
        TERMINAL_BATCH_STATUSES.has(existing.status) &&
        reopening
      ) {
        throw new HttpException(
          `Cannot move batch from "${existing.status}" back to "${params.status}"`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    // The read above is advisory — a concurrent completion between it and
    // this write must not resurrect a terminal batch. When reopening, the
    // write itself only lands on a non-terminal row, so the check and the
    // write are atomic. Reopening next to a second active batch trips the
    // partial unique index (P2002), which maps to 409 like the create path.
    let result: { count: number };
    try {
      const reopening =
        params.status === 'pending' || params.status === 'running';
      result = await db.remediationBatch.updateMany({
        where: {
          id: params.batchId,
          organizationId: params.organizationId,
          ...(params.status && reopening
            ? {
                status: {
                  notIn: [...TERMINAL_BATCH_STATUSES],
                },
              }
            : {}),
        },
        data: {
          ...(params.triggerRunId && { triggerRunId: params.triggerRunId }),
          ...(params.status && { status: params.status }),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new HttpException(
          'A batch is already active for this connection',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
    if (result.count === 0) {
      // The row exists but the write matched nothing: a concurrent
      // transition made it terminal after the pre-check (lost the reopen
      // race). Report the same 400 instead of a misleading 404.
      const current = await db.remediationBatch.findFirst({
        where: { id: params.batchId, organizationId: params.organizationId },
        select: { status: true },
      });
      if (!current) {
        throw new HttpException('Batch not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        `Cannot move batch from "${current.status}" back to "${params.status}"`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const batch = await db.remediationBatch.findFirst({
      where: { id: params.batchId, organizationId: params.organizationId },
    });
    return { data: batch };
  }

  async skipFinding(params: {
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
    if (
      batch.status !== undefined &&
      !ACTIVE_BATCH_STATUSES.has(batch.status)
    ) {
      throw new HttpException(
        `Cannot skip a finding in a "${batch.status}" batch`,
        HttpStatus.BAD_REQUEST,
      );
    }
    let findings = batch.findings as Array<{ id: string; status: string }>;
    const target = findings.find((f) => f.id === params.findingId);
    if (!target) {
      throw new HttpException(
        'Finding not found in batch',
        HttpStatus.NOT_FOUND,
      );
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

    // Compare-and-swap on the findings document: the worker's progress
    // writes land in the same JSON column, so a blind read-modify-write
    // would clobber them (and vice versa). On a lost race, re-read and
    // retry against the fresh document instead of writing stale state.
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
}
