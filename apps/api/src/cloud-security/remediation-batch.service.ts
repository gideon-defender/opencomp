import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { db, Prisma } from '@db';
import {
  ACTIVE_BATCH_STATUSES,
  TERMINAL_BATCH_STATUSES,
} from './remediation-batch-status';
import { resolveTerminalOutcome } from './remediation-batch-terminal';
import { skipFindingInBatch } from './remediation-batch-skip';

type CreatedRemediationBatch = Awaited<
  ReturnType<typeof db.remediationBatch.create>
>;

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
      const title = f.title.trim();
      if (!id || !key) {
        throw new HttpException(
          'Each finding must have a non-empty id and key',
          HttpStatus.BAD_REQUEST,
        );
      }
      // Titles land in logs and UI — reject control characters that forge
      // log lines. Same guard for id/key, which feed queries and display.
      for (const value of [id, key, title]) {
        if (/[\r\n]/.test(value)) {
          throw new HttpException(
            'Finding id, key, and title must not contain line breaks',
            HttpStatus.BAD_REQUEST,
          );
        }
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
        title,
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
    if (params.status || params.triggerRunId) {
      const existing = await db.remediationBatch.findFirst({
        where: { id: params.batchId, organizationId: params.organizationId },
        select: { status: true, triggerRunId: true },
      });
      if (!existing) {
        throw new HttpException('Batch not found', HttpStatus.NOT_FOUND);
      }
      const reopening =
        params.status === 'pending' || params.status === 'running';
      const isTerminal =
        existing.status !== undefined &&
        TERMINAL_BATCH_STATUSES.has(existing.status);
      if (isTerminal && reopening) {
        throw new HttpException(
          `Cannot move batch from "${existing.status}" back to "${params.status}"`,
          HttpStatus.BAD_REQUEST,
        );
      }
      if (isTerminal && !reopening) {
        // Retried terminal writes are idempotent — at-least-once callbacks
        // resend the same end state. Anything else fails closed.
        return resolveTerminalOutcome({
          batchId: params.batchId,
          organizationId: params.organizationId,
          status: params.status,
          triggerRunId: params.triggerRunId,
          currentStatus: existing.status,
          currentTriggerRunId: existing.triggerRunId,
        });
      }
    }
    // The read above is advisory — a concurrent completion between it and
    // this write must not touch a terminal batch. The write only lands on
    // a non-terminal row (no `connectionId` ever changes here, so P2002
    // cannot fire — the catch stays as defense-in-depth). The count-0
    // handler mirrors the pre-check outcome, including idempotent success.
    let result: { count: number };
    try {
      result = await db.remediationBatch.updateMany({
        where: {
          id: params.batchId,
          organizationId: params.organizationId,
          status: {
            notIn: [...TERMINAL_BATCH_STATUSES],
          },
        },
        data: {
          ...(params.triggerRunId !== undefined && {
            triggerRunId: params.triggerRunId,
          }),
          ...(params.status !== undefined && { status: params.status }),
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
      // Lost the race: a concurrent transition made the row terminal after
      // the pre-check. Mirror the pre-check outcome instead of a false 404.
      const current = await db.remediationBatch.findFirst({
        where: { id: params.batchId, organizationId: params.organizationId },
        select: { status: true, triggerRunId: true },
      });
      if (!current) {
        throw new HttpException('Batch not found', HttpStatus.NOT_FOUND);
      }
      const reopening =
        params.status === 'pending' || params.status === 'running';
      if (reopening) {
        throw new HttpException(
          `Cannot move batch from "${current.status}" back to "${params.status}"`,
          HttpStatus.BAD_REQUEST,
        );
      }
      return resolveTerminalOutcome({
        batchId: params.batchId,
        organizationId: params.organizationId,
        status: params.status,
        triggerRunId: params.triggerRunId,
        currentStatus: current.status,
        currentTriggerRunId: current.triggerRunId,
      });
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
    return skipFindingInBatch(params);
  }
}
