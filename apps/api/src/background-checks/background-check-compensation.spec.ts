import { ServiceUnavailableException } from '@nestjs/common';
import { BackgroundCheckStatus, db } from '@db';
import {
  chargeOrRollbackClaim,
  reclaimStalePaymentlessClaim,
  refundBestEffort,
} from './background-check-compensation';
import type { BackgroundCheckPaymentService } from './background-check-payment.service';

jest.mock('@db', () => ({
  BackgroundCheckStatus: {
    invited: 'invited',
    failed: 'failed',
    in_progress: 'in_progress',
  },
  db: {
    backgroundCheckRequest: {
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

const mockedDelete = db.backgroundCheckRequest.delete as jest.Mock;
const mockedDeleteMany = db.backgroundCheckRequest.deleteMany as jest.Mock;

function paymentServiceWith(
  overrides: Partial<BackgroundCheckPaymentService> = {},
): BackgroundCheckPaymentService {
  return {
    charge: jest.fn(),
    refund: jest.fn().mockResolvedValue('re_1'),
    getBackgroundCheckPrice: jest.fn(),
    ...overrides,
  } as unknown as BackgroundCheckPaymentService;
}

const baseParams = {
  organizationId: 'org_1',
  memberId: 'mem_1',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('refundBestEffort', () => {
  it('returns the Stripe refund id on success', async () => {
    const paymentService = paymentServiceWith();

    const refundId = await refundBestEffort({
      paymentService,
      ...baseParams,
      paymentIntentId: 'pi_1',
      backgroundCheckRequestId: 'bcr_1',
      step: 'checkr-create',
    });

    expect(refundId).toBe('re_1');
  });

  it('returns null without throwing when the refund fails', async () => {
    const paymentService = paymentServiceWith({
      refund: jest.fn().mockResolvedValue(null),
    });

    const refundId = await refundBestEffort({
      paymentService,
      ...baseParams,
      paymentIntentId: 'pi_1',
      backgroundCheckRequestId: 'bcr_1',
      step: 'persist-ids',
    });

    expect(refundId).toBeNull();
  });

  it('returns null without throwing when refund itself rejects', async () => {
    const paymentService = paymentServiceWith({
      refund: jest.fn().mockRejectedValue(new Error('stripe down')),
    });

    const refundId = await refundBestEffort({
      paymentService,
      ...baseParams,
      paymentIntentId: 'pi_1',
      backgroundCheckRequestId: 'bcr_1',
      step: 'persist-payment',
    });

    expect(refundId).toBeNull();
  });
});

describe('reclaimStalePaymentlessClaim', () => {
  function staleRow() {
    return {
      id: 'bcr_1',
      status: BackgroundCheckStatus.invited,
      stripePaymentIntentId: null,
      identityBackgroundCheckId: null,
      lastSyncedAt: new Date(Date.now() - 10 * 60 * 1000),
    };
  }

  it('returns false without touching the database when there is no row', async () => {
    const reclaimed = await reclaimStalePaymentlessClaim({
      ...baseParams,
      existing: null,
    });

    expect(reclaimed).toBe(false);
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('returns false for an in-flight payment-less claim', async () => {
    const reclaimed = await reclaimStalePaymentlessClaim({
      ...baseParams,
      existing: { ...staleRow(), lastSyncedAt: new Date() },
    });

    expect(reclaimed).toBe(false);
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('returns false for rows that carry a payment or a vendor pointer', async () => {
    for (const existing of [
      { ...staleRow(), stripePaymentIntentId: 'pi_1' },
      { ...staleRow(), identityBackgroundCheckId: 'rep_1' },
      { ...staleRow(), status: BackgroundCheckStatus.failed },
    ]) {
      const reclaimed = await reclaimStalePaymentlessClaim({
        ...baseParams,
        existing,
      });
      expect(reclaimed).toBe(false);
    }
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('deletes a stale payment-less claim and returns true', async () => {
    mockedDeleteMany.mockResolvedValue({ count: 1 });

    const reclaimed = await reclaimStalePaymentlessClaim({
      ...baseParams,
      existing: staleRow(),
    });

    expect(reclaimed).toBe(true);
    expect(mockedDeleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'bcr_1',
        status: BackgroundCheckStatus.invited,
        stripePaymentIntentId: null,
        identityBackgroundCheckId: null,
        lastSyncedAt: expect.objectContaining({ lte: expect.any(Date) }),
      }),
    });
  });

  it('returns false when a concurrent payment wins the reclaim race', async () => {
    mockedDeleteMany.mockResolvedValue({ count: 0 });

    const reclaimed = await reclaimStalePaymentlessClaim({
      ...baseParams,
      existing: staleRow(),
    });

    expect(reclaimed).toBe(false);
  });

  it('throws 503 when the reclaim delete fails', async () => {
    mockedDeleteMany.mockRejectedValue(new Error('db down'));

    await expect(
      reclaimStalePaymentlessClaim({ ...baseParams, existing: staleRow() }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('chargeOrRollbackClaim', () => {
  it('returns the charge result without deleting on success', async () => {
    const paymentService = paymentServiceWith({
      charge: jest.fn().mockResolvedValue({ paymentIntentId: 'pi_1' }),
    });

    const payment = await chargeOrRollbackClaim({
      paymentService,
      ...baseParams,
      createdId: 'bcr_1',
    });

    expect(payment).toEqual({ paymentIntentId: 'pi_1' });
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('deletes the slot claim and rethrows the charge error', async () => {
    const chargeError = new Error('charge failed');
    const paymentService = paymentServiceWith({
      charge: jest.fn().mockRejectedValue(chargeError),
    });
    mockedDelete.mockResolvedValue({ id: 'bcr_1' });

    await expect(
      chargeOrRollbackClaim({
        paymentService,
        ...baseParams,
        createdId: 'bcr_1',
      }),
    ).rejects.toBe(chargeError);
    expect(mockedDelete).toHaveBeenCalledWith({ where: { id: 'bcr_1' } });
  });
});
