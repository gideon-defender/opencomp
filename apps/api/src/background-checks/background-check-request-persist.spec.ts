import { NotFoundException } from '@nestjs/common';
import { BackgroundCheckStatus, db } from '@db';
import {
  markRequestFailed,
  persistCheckrResult,
} from './background-check-request-persist';
import type { BackgroundCheckPaymentService } from './background-check-payment.service';

jest.mock('@db', () => ({
  BackgroundCheckStatus: {
    invited: 'invited',
    in_progress: 'in_progress',
    completed: 'completed',
    completed_with_flags: 'completed_with_flags',
    failed: 'failed',
    cancelled: 'cancelled',
  },
  db: {
    backgroundCheckRequest: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

const mockedFindUnique = db.backgroundCheckRequest
  .findUnique as unknown as jest.Mock;
const mockedUpdateMany = db.backgroundCheckRequest
  .updateMany as unknown as jest.Mock;

function paymentService(): BackgroundCheckPaymentService {
  return {
    charge: jest.fn(),
    refund: jest.fn().mockResolvedValue('re_1'),
    getBackgroundCheckPrice: jest.fn(),
  } as unknown as BackgroundCheckPaymentService;
}

const baseParams = {
  organizationId: 'org_1',
  memberId: 'mem_1',
  createdId: 'bcr_1',
  paymentIntentId: 'pi_1',
};

function identityResult() {
  return {
    id: 'check_1',
    status: BackgroundCheckStatus.in_progress,
    candidateId: 'cand_1',
    invitationId: null,
    candidateUrl: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('persistCheckrResult', () => {
  it('persists the pointer and status on the happy path', async () => {
    mockedUpdateMany.mockResolvedValue({ count: 1 });
    const written = { id: 'bcr_1', status: 'in_progress' };
    mockedFindUnique.mockResolvedValue(written);

    const result = await persistCheckrResult({
      ...baseParams,
      identityResult: identityResult(),
      paymentService: paymentService(),
    });

    expect(result).toBe(written);
    expect(mockedUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'bcr_1',
          identityBackgroundCheckId: null,
          status: expect.objectContaining({ notIn: expect.any(Array) }),
        }),
        data: expect.objectContaining({
          identityBackgroundCheckId: 'check_1',
          status: 'in_progress',
        }),
      }),
    );
  });

  it('returns the live retry attempt without refunding on a pointer swap', async () => {
    mockedUpdateMany.mockResolvedValue({ count: 0 });
    const liveAttempt = {
      id: 'bcr_1',
      status: 'invited',
      identityBackgroundCheckId: 'check_retry',
    };
    mockedFindUnique.mockResolvedValue(liveAttempt);
    const payment = paymentService();

    const result = await persistCheckrResult({
      ...baseParams,
      identityResult: identityResult(),
      paymentService: payment,
    });

    expect(result).toBe(liveAttempt);
    expect(payment.refund).not.toHaveBeenCalled();
  });

  it('freezes a mid-flight terminal success without writing or refunding', async () => {
    mockedUpdateMany.mockResolvedValue({ count: 0 });
    const finished = {
      id: 'bcr_1',
      status: 'completed',
      identityBackgroundCheckId: 'check_1',
    };
    mockedFindUnique.mockResolvedValue(finished);
    const payment = paymentService();

    const result = await persistCheckrResult({
      ...baseParams,
      identityResult: identityResult(),
      paymentService: payment,
    });

    expect(result).toBe(finished);
    expect(payment.refund).not.toHaveBeenCalled();
  });

  it('refunds a mid-flight terminal failure and persists the refund id', async () => {
    mockedUpdateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const failed = {
      id: 'bcr_1',
      status: 'failed',
      identityBackgroundCheckId: null,
      stripeRefundId: null,
    };
    const stamped = { ...failed, stripeRefundId: 're_1' };
    mockedFindUnique
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(stamped);
    const payment = paymentService();

    const result = await persistCheckrResult({
      ...baseParams,
      identityResult: identityResult(),
      paymentService: payment,
    });

    expect(result).toBe(stamped);
    expect(payment.refund).toHaveBeenCalledWith({
      organizationId: 'org_1',
      memberId: 'mem_1',
      paymentIntentId: 'pi_1',
    });
    // The refund marker lands on the terminal row without touching status.
    expect(mockedUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'bcr_1',
          status: expect.objectContaining({ in: expect.any(Array) }),
        }),
        data: expect.objectContaining({ stripeRefundId: 're_1' }),
      }),
    );
  });

  it('does not refund twice when the terminal row already carries a refund id', async () => {
    mockedUpdateMany.mockResolvedValue({ count: 0 });
    const failed = {
      id: 'bcr_1',
      status: 'failed',
      identityBackgroundCheckId: null,
      stripeRefundId: 're_earlier',
    };
    mockedFindUnique.mockResolvedValue(failed);
    const payment = paymentService();

    const result = await persistCheckrResult({
      ...baseParams,
      identityResult: identityResult(),
      paymentService: payment,
    });

    expect(result).toBe(failed);
    expect(payment.refund).not.toHaveBeenCalled();
    expect(mockedUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('throws NotFound when the row was deleted mid-flight', async () => {
    mockedUpdateMany.mockResolvedValue({ count: 0 });
    mockedFindUnique.mockResolvedValue(null);

    await expect(
      persistCheckrResult({
        ...baseParams,
        identityResult: identityResult(),
        paymentService: paymentService(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('markRequestFailed', () => {
  it('marks the row failed with a terminal-excluding predicate', async () => {
    mockedUpdateMany.mockResolvedValue({ count: 1 });

    await markRequestFailed({
      ...baseParams,
      refundId: 're_1',
      step: 'checkr-create',
    });

    expect(mockedUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'bcr_1',
          identityBackgroundCheckId: null,
          status: expect.objectContaining({ notIn: expect.any(Array) }),
        }),
        data: expect.objectContaining({
          status: BackgroundCheckStatus.failed,
          stripeRefundId: 're_1',
        }),
      }),
    );
  });

  it('absorbs a failed mark without throwing so the original error surfaces', async () => {
    mockedUpdateMany.mockRejectedValue(new Error('db down'));

    await expect(
      markRequestFailed({
        ...baseParams,
        refundId: 're_1',
        step: 'persist-ids',
      }),
    ).resolves.toBeUndefined();
  });
});
