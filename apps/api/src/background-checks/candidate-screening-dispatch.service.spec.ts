import { db, type CandidateScreening } from '@db';
import { CandidateScreeningDispatchService } from './candidate-screening-dispatch.service';
import { CheckrIntakeConfigService } from './checkr-intake-config.service';
import { BillingEntitlementsService } from '../billing/billing-entitlements.service';
import { CheckrIntakeRejected } from './checkr-intake-client';

jest.mock('@db', () => ({
  db: {
    candidateScreening: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      findFirstOrThrow: jest.fn(),
    },
    billingUsageEvent: { findFirst: jest.fn() },
    billingCreditEvent: { findFirst: jest.fn() },
  },
}));

const row = (): CandidateScreening => ({
  id: 'pcs_a',
  organizationId: 'tenant_a',
  candidateId: 'pcd_a',
  connectionId: 'ckc_a',
  operationId: 'op_a',
  email: 'a@b.com',
  firstName: 'A',
  lastName: 'B',
  country: 'US',
  state: 'CA',
  city: null,
  package: 'basic',
  node: null,
  status: 'queued',
  candidateKey: 'candidate-key',
  invitationKey: 'invitation-key',
  checkrCandidateId: null,
  checkrInvitationId: null,
  chargedAt: null,
  dispatchedAt: null,
  firstDispatchAt: null,
  attempts: 1,
  leaseToken: 'lease',
  leaseUntil: new Date(),
  nextAttemptAt: new Date(),
  errorCode: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('Candidate dispatch recovery', () => {
  const client = { createCandidate: jest.fn(), invite: jest.fn() };
  const config = { client: jest.fn() };
  const billing = {
    tryConsumeIncludedUsageForProduct: jest.fn(),
    refundIncludedUsageForProduct: jest.fn(),
  };
  const service = new CandidateScreeningDispatchService(
    config as unknown as CheckrIntakeConfigService,
    billing as unknown as BillingEntitlementsService,
  );
  const dispatch = () =>
    service.dispatch({ id: 'pcs_a', organizationId: 'tenant_a' });
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(db.candidateScreening.updateMany)
      .mockResolvedValue({ count: 1 });
    jest
      .mocked(db.candidateScreening.findFirstOrThrow)
      .mockResolvedValue(row());
    jest.mocked(db.billingUsageEvent.findFirst).mockResolvedValue(null);
    jest.mocked(db.billingCreditEvent.findFirst).mockResolvedValue(null);
    config.client.mockResolvedValue({ client });
    billing.tryConsumeIncludedUsageForProduct.mockResolvedValue({
      status: 'consumed',
    });
    client.createCandidate.mockResolvedValue('checkr_c');
    client.invite.mockResolvedValue('checkr_i');
  });

  it('charges once, persists the candidate before invitation, and creates no account', async () => {
    await dispatch();
    expect(config.client).toHaveBeenCalledWith({
      organizationId: 'tenant_a',
      connectionId: 'ckc_a',
    });
    expect(billing.tryConsumeIncludedUsageForProduct).toHaveBeenCalledWith({
      organizationId: 'tenant_a',
      productKey: 'background_check',
      sourceResourceId: 'pcs_a',
    });
    expect(client.invite).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: 'checkr_c',
        key: 'invitation-key',
      }),
    );
    expect(db.candidateScreening.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'tenant_a',
          leaseToken: expect.any(String),
        }),
        data: expect.objectContaining({
          status: 'invited',
          checkrInvitationId: 'checkr_i',
        }),
      }),
    );
  });

  it('never dispatches when another worker holds the lease', async () => {
    jest
      .mocked(db.candidateScreening.updateMany)
      .mockResolvedValue({ count: 0 });
    await dispatch();
    expect(config.client).not.toHaveBeenCalled();
    expect(billing.tryConsumeIncludedUsageForProduct).not.toHaveBeenCalled();
  });

  it('recovers an invitation timeout using the saved candidate and identical key without charging again', async () => {
    jest.mocked(db.candidateScreening.findFirstOrThrow).mockResolvedValue({
      ...row(),
      checkrCandidateId: 'checkr_c',
      chargedAt: new Date(),
    });
    client.invite.mockRejectedValue(new Error('timeout'));
    await dispatch();
    expect(client.createCandidate).not.toHaveBeenCalled();
    expect(billing.tryConsumeIncludedUsageForProduct).not.toHaveBeenCalled();
    expect(billing.refundIncludedUsageForProduct).not.toHaveBeenCalled();
    expect(db.candidateScreening.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorCode: 'dispatch_retry_pending' }),
      }),
    );
  });

  it('records durable refund work for a definite vendor rejection', async () => {
    client.invite.mockRejectedValue(new CheckrIntakeRejected());
    await dispatch();
    expect(db.candidateScreening.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'refunding' }),
      }),
    );
  });

  it('retries refund work without another vendor write', async () => {
    jest.mocked(db.candidateScreening.findFirstOrThrow).mockResolvedValue({
      ...row(),
      status: 'refunding',
      chargedAt: new Date(),
    });
    billing.refundIncludedUsageForProduct.mockResolvedValue(undefined);
    await dispatch();
    expect(billing.refundIncludedUsageForProduct).toHaveBeenCalledWith(
      expect.objectContaining({ sourceResourceId: 'pcs_a' }),
    );
    expect(client.invite).not.toHaveBeenCalled();
  });

  it('stops ambiguous recovery before Checkr idempotency expires', async () => {
    jest.mocked(db.candidateScreening.findFirstOrThrow).mockResolvedValue({
      ...row(),
      firstDispatchAt: new Date(Date.now() - 21 * 60 * 60_000),
    });
    await dispatch();
    expect(client.invite).not.toHaveBeenCalled();
    expect(db.candidateScreening.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'needs_review' }),
      }),
    );
  });

  it('does not refund an unknown invitation outcome when account credentials fail', async () => {
    jest.mocked(db.candidateScreening.findFirstOrThrow).mockResolvedValue({
      ...row(),
      status: 'dispatching',
      chargedAt: new Date(),
      checkrCandidateId: 'checkr_c',
      firstDispatchAt: new Date(),
    });
    config.client.mockRejectedValue(
      new Error('Account credentials unavailable'),
    );
    await dispatch();
    expect(billing.refundIncludedUsageForProduct).not.toHaveBeenCalled();
    expect(client.invite).not.toHaveBeenCalled();
    expect(db.candidateScreening.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorCode: 'dispatch_retry_pending' }),
      }),
    );
  });

  it('recovers ledger consumption before chargedAt was saved without consuming again', async () => {
    jest.mocked(db.billingUsageEvent.findFirst).mockResolvedValue({
      id: 'usage_a',
      organizationId: 'tenant_a',
      skuKey: 'background_checks_monthly_3',
      eventType: 'consume',
      quantity: 1,
      sourceResourceId: 'pcs_a',
      idempotencyKey: 'consume-key',
      stripeSubscriptionItemId: null,
      periodStart: null,
      periodEnd: null,
      stripeInvoiceId: null,
      stripeEventId: null,
      createdAt: new Date(),
    });
    await dispatch();
    expect(billing.tryConsumeIncludedUsageForProduct).not.toHaveBeenCalled();
    expect(client.invite).toHaveBeenCalledTimes(1);
  });
});
