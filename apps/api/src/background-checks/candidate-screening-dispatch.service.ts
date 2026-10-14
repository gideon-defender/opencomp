import { Injectable, Logger } from '@nestjs/common';
import { db, type Prisma } from '@db';
import { randomUUID } from 'node:crypto';
import { BillingEntitlementsService } from '../billing/billing-entitlements.service';
import { CheckrIntakeConfigService } from './checkr-intake-config.service';
import { CheckrIntakeRejected } from './checkr-intake-client';

class LeaseLost extends Error {}
const LEASE_MS = 5 * 60_000;
// Checkr POST idempotency expires after 24h. Never blindly replay past it.
const RECOVERY_WINDOW_MS = 20 * 60 * 60_000;

@Injectable()
export class CandidateScreeningDispatchService {
  private readonly logger = new Logger(CandidateScreeningDispatchService.name);
  constructor(
    private readonly config: CheckrIntakeConfigService,
    private readonly billing: BillingEntitlementsService,
  ) {}

  async runPending() {
    const pending = await db.candidateScreening.findMany({
      where: {
        status: { in: ['queued', 'dispatching', 'refunding'] },
        nextAttemptAt: { lte: new Date() },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: 20,
      select: { id: true, organizationId: true },
    });
    for (const row of pending) {
      try {
        await this.dispatch(row);
      } catch {
        this.logger.warn('Candidate dispatch remains recoverable', {
          screeningId: row.id,
        });
      }
    }
    return { checked: pending.length };
  }

  async dispatch(params: { id: string; organizationId: string }) {
    const token = randomUUID();
    const claim = await db.candidateScreening.updateMany({
      where: {
        ...params,
        status: { in: ['queued', 'dispatching', 'refunding'] },
        nextAttemptAt: { lte: new Date() },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: {
        leaseToken: token,
        leaseUntil: new Date(Date.now() + LEASE_MS),
        attempts: { increment: 1 },
      },
    });
    if (!claim.count) return;
    const row = await db.candidateScreening.findFirstOrThrow({
      where: { ...params, leaseToken: token },
    });
    const write = async (
      data: Prisma.CandidateScreeningUpdateManyMutationInput,
    ) => {
      const result = await db.candidateScreening.updateMany({
        where: { ...params, leaseToken: token },
        data,
      });
      if (!result.count) throw new LeaseLost();
    };
    const finish = async (
      data: Prisma.CandidateScreeningUpdateManyMutationInput,
    ) => write({ ...data, leaseToken: null, leaseUntil: null });
    try {
      if (row.status === 'refunding') {
        await this.billing.refundIncludedUsageForProduct({
          organizationId: row.organizationId,
          productKey: 'background_check',
          sourceResourceId: row.id,
          reason: 'checkr_intake_rejected',
        });
        await finish({ status: 'failed' });
        return;
      }
      if (
        row.firstDispatchAt &&
        (Date.now() - row.firstDispatchAt.getTime() > RECOVERY_WINDOW_MS ||
          row.attempts > 8)
      ) {
        await finish({
          status: 'needs_review',
          errorCode: 'dispatch_outcome_requires_review',
        });
        return;
      }
      const { client } = await this.config.client({
        organizationId: row.organizationId,
        connectionId: row.connectionId,
      });
      if (!row.chargedAt) {
        // Recover a crash after ledger consumption but before chargedAt.
        const where = {
          organizationId: row.organizationId,
          sourceResourceId: row.id,
          eventType: 'consume',
        };
        const [consumed, credit] = await Promise.all([
          db.billingUsageEvent.findFirst({ where, select: { id: true } }),
          db.billingCreditEvent.findFirst({ where, select: { id: true } }),
        ]);
        if (!consumed && !credit) {
          const usage = await this.billing.tryConsumeIncludedUsageForProduct({
            organizationId: row.organizationId,
            productKey: 'background_check',
            sourceResourceId: row.id,
          });
          if (usage.status !== 'consumed') {
            await finish({
              status: 'failed',
              errorCode:
                usage.status === 'exhausted'
                  ? 'background_check_subscription_exhausted'
                  : 'background_check_subscription_required',
            });
            return;
          }
        }
        await write({ chargedAt: new Date() });
      }
      await write({
        status: 'dispatching',
        firstDispatchAt: row.firstDispatchAt ?? new Date(),
      });
      let candidateId = row.checkrCandidateId;
      if (!candidateId) {
        candidateId = await client.createCandidate({
          email: row.email,
          firstName: row.firstName,
          lastName: row.lastName,
          key: row.candidateKey,
        });
        await write({ checkrCandidateId: candidateId });
      }
      const invitationId = await client.invite({
        candidateId,
        package: row.package,
        node: row.node,
        country: row.country,
        state: row.state,
        city: row.city,
        key: row.invitationKey,
      });
      await finish({
        status: 'invited',
        checkrInvitationId: invitationId,
        dispatchedAt: new Date(),
        errorCode: null,
      });
    } catch (error) {
      if (error instanceof LeaseLost) return;
      if (error instanceof CheckrIntakeRejected) {
        // Commit refund work before releasing the lease. A crash or failed
        // refund is picked up by the next outbox run; no new vendor write.
        await finish({
          status: 'refunding',
          errorCode: 'checkr_rejected',
          nextAttemptAt: new Date(),
        });
        return;
      }
      await finish({
        errorCode: 'dispatch_retry_pending',
        nextAttemptAt: new Date(
          Date.now() +
            Math.min(60 * 60_000, 60_000 * 2 ** Math.min(row.attempts, 6)),
        ),
      });
    }
  }
}
