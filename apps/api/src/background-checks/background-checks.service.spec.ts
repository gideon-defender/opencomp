import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { CheckrClient } from './checkr.client';
import { BillingService } from '../billing/billing.service';
import { BackgroundCheckBillingService } from './background-check-billing.service';
import { BackgroundCheckPaymentService } from './background-check-payment.service';
import { BackgroundChecksService } from './background-checks.service';
import { db, Prisma } from '@db';

jest.mock('@db', () => {
  class PrismaClientKnownRequestError extends Error {
    code: string;

    constructor(message: string, options: { code: string }) {
      super(message);
      this.code = options.code;
    }
  }

  return {
    BackgroundCheckStatus: {
      invited: 'invited',
      in_progress: 'in_progress',
      in_review: 'in_review',
      completed: 'completed',
      completed_with_flags: 'completed_with_flags',
      failed: 'failed',
      cancelled: 'cancelled',
    },
    Prisma: {
      PrismaClientKnownRequestError,
      JsonNull: 'JsonNull',
    },
    db: {
      backgroundCheckRequest: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      backgroundCheckWebhookEvent: {
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      member: {
        findFirst: jest.fn(),
      },
      organizationBilling: {
        findUnique: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
      },
      securityPenetrationTestRun: {
        count: jest.fn(),
      },
      organization: {
        findUnique: jest.fn(),
      },
    },
  };
});

const mockedDb = db as jest.Mocked<typeof db>;

function mockAsync<T>(fn: unknown): jest.MockedFunction<() => Promise<T>> {
  return fn as jest.MockedFunction<() => Promise<T>>;
}

function invocationOrder(fn: unknown, index = 0): number {
  return (
    (fn as { mock: { invocationCallOrder: number[] } }).mock
      .invocationCallOrder[index] ?? 0
  );
}

describe('background checks', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset (not just clear): a test that rejects before consuming its
    // queued mockResolvedValueOnce values must not leak them into the next
    // test's reads.
    for (const model of [
      mockedDb.backgroundCheckRequest,
      mockedDb.backgroundCheckWebhookEvent,
      mockedDb.member,
    ]) {
      for (const fn of Object.values(model)) {
        (fn as unknown as jest.Mock).mockReset?.();
      }
    }
    // Clear calls on non-db mocks (e.g. global fetch spies) without
    // touching implementations.
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      CHECKR_API_KEY: 'checkr_test',
      CHECKR_PACKAGE: 'tasker_standard',
      CHECKR_API_BASE_URL: 'https://api.checkr.com',
      CHECKR_WEBHOOK_SECRET: 'whsec_test',
      STRIPE_BACKGROUND_CHECK_PRICE_ID: 'price_bg',
      NEXT_PUBLIC_APP_URL: 'https://app.gideondefender.com',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('creates a Checkr candidate with expected Basic auth and body', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'cand_1' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'rep_1',
            status: 'pending',
            invitation_url: 'https://checkr.com/invite',
          }),
          { status: 200 },
        ),
      );

    const client = new CheckrClient();
    await client.createBackgroundCheck({
      organizationId: 'org_1',
      memberId: 'mem_1',
      employeeName: 'Ada Lovelace',
      employeeEmail: 'ada@example.com',

      idempotencyKey: 'comp-background-check:mem_1',
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      'https://api.checkr.com/v1/candidates',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('checkr_test:').toString('base64')}`,
        }),
      }),
    );
    const firstBody = JSON.parse(
      fetchSpy.mock.calls[0]?.[1]?.body as string,
    ) as {
      email: string;
      first_name: string;
      last_name: string;
      metadata: { compOrganizationId: string; compMemberId: string };
    };
    expect(firstBody.email).toBe('ada@example.com');
    expect(firstBody.first_name).toBe('Ada');
    expect(firstBody.last_name).toBe('Lovelace');
    expect(firstBody.metadata).toEqual({
      compOrganizationId: 'org_1',
      compMemberId: 'mem_1',
      rerunCount: 'comp-background-check:mem_1',
    });
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      'https://api.checkr.com/v1/invitations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('checkr_test:').toString('base64')}`,
        }),
      }),
    );
  });

  it('does not send a per-request callbackUrl (webhook is configured in dashboard)', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'cand_1' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'rep_1',
            invitation_url: 'https://checkr.com/invite',
          }),
          {
            status: 200,
          },
        ),
      );

    const client = new CheckrClient();
    await client.createBackgroundCheck({
      organizationId: 'org_1',
      memberId: 'mem_1',
      employeeName: 'Ada Lovelace',
      employeeEmail: 'ada@example.com',
      idempotencyKey: 'comp-background-check:mem_1',
    });

    // Checkr does not send callbackUrl per-request; webhook is configured in dashboard
    const firstBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    expect(firstBody).not.toHaveProperty('callbackUrl');
  });

  it('reports non-json Checkr failures without throwing a parse error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('No matching routes found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
    );

    const client = new CheckrClient();

    await expect(
      client.createBackgroundCheck({
        organizationId: 'org_1',
        memberId: 'mem_1',
        employeeName: 'Ada Lovelace',
        employeeEmail: 'ada@example.com',

        idempotencyKey: 'comp-background-check:mem_1',
      }),
    ).rejects.toThrow('Checkr candidate creation failed.');
  });

  it('returns an existing request without charging or calling Identity', async () => {
    const existing = { id: 'bcr_1', status: 'invited' };
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>>(
      mockedDb.backgroundCheckRequest.findUnique,
    ).mockResolvedValueOnce(
      existing as Awaited<
        ReturnType<typeof db.backgroundCheckRequest.findUnique>
      >,
    );
    const identityClient = { createBackgroundCheck: jest.fn() };
    const paymentService = { charge: jest.fn(), refund: jest.fn() };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      paymentService as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.requestForMember({
      organizationId: 'org_1',
      memberId: 'mem_1',
      employeeName: 'Ada Lovelace',
      employeeEmail: 'ada@example.com',
    });

    expect(result).toBe(existing);
    expect(paymentService.charge).not.toHaveBeenCalled();
    expect(identityClient.createBackgroundCheck).not.toHaveBeenCalled();
  });

  it('refunds the payment and stores failed status when Identity fails', async () => {
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>>(
      mockedDb.backgroundCheckRequest.findUnique,
    ).mockResolvedValueOnce(null);
    mockAsync<Awaited<ReturnType<typeof db.member.findFirst>>>(
      mockedDb.member.findFirst,
    ).mockResolvedValueOnce({
      id: 'mem_1',
      organizationId: 'org_1',
    } as Awaited<ReturnType<typeof db.member.findFirst>>);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>>(
      mockedDb.backgroundCheckRequest.create,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      status: 'invited',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>>(
      mockedDb.backgroundCheckRequest.update,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      status: 'invited',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>);
    // The Step 4 failed-mark is guarded on the null pointer so a
    // concurrent retry swap wins over it.
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>>(
      mockedDb.backgroundCheckRequest.updateMany,
    ).mockResolvedValueOnce({
      count: 1,
    });

    const identityClient = {
      assertConfigured: jest.fn(),
      assertCreatableInput: jest.fn(),
      createBackgroundCheck: jest
        .fn()
        .mockRejectedValue(new Error('identity down')),
    };
    const paymentService = {
      charge: jest.fn().mockResolvedValue({
        paymentIntentId: 'pi_1',
        status: 'succeeded',
        amount: 1000,
        currency: 'usd',
      }),
      refund: jest.fn().mockResolvedValue('re_1'),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      paymentService as unknown as BackgroundCheckPaymentService,
    );

    await expect(
      service.requestForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
        employeeName: 'Ada Lovelace',
        employeeEmail: 'ada@example.com',
      }),
    ).rejects.toThrow('identity down');

    expect(paymentService.refund).toHaveBeenCalledWith({
      organizationId: 'org_1',
      memberId: 'mem_1',
      paymentIntentId: 'pi_1',
    });
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'bcr_1',
          identityBackgroundCheckId: null,
        }),
        data: expect.objectContaining({
          status: 'failed',
          stripeRefundId: 're_1',
        }),
      }),
    );
  });

  it('does not clobber a concurrent retry swap when Checkr create fails', async () => {
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>>(
      mockedDb.backgroundCheckRequest.findUnique,
    ).mockResolvedValueOnce(null);
    mockAsync<Awaited<ReturnType<typeof db.member.findFirst>>>(
      mockedDb.member.findFirst,
    ).mockResolvedValueOnce({
      id: 'mem_1',
      organizationId: 'org_1',
    } as Awaited<ReturnType<typeof db.member.findFirst>>);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>>(
      mockedDb.backgroundCheckRequest.create,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      status: 'invited',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>>(
      mockedDb.backgroundCheckRequest.update,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      status: 'invited',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>);
    // A retry swapped in a fresh vendor check while the Checkr create call
    // was in flight: the guarded failed-mark matches nothing.
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>>(
      mockedDb.backgroundCheckRequest.updateMany,
    ).mockResolvedValueOnce({
      count: 0,
    });

    const identityClient = {
      assertConfigured: jest.fn(),
      assertCreatableInput: jest.fn(),
      createBackgroundCheck: jest
        .fn()
        .mockRejectedValue(new Error('identity down')),
    };
    const paymentService = {
      charge: jest.fn().mockResolvedValue({
        paymentIntentId: 'pi_1',
        status: 'succeeded',
        amount: 1000,
        currency: 'usd',
      }),
      refund: jest.fn().mockResolvedValue('re_1'),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      paymentService as unknown as BackgroundCheckPaymentService,
    );

    // The original Checkr error still surfaces, and the refund for this
    // attempt's charge still runs — but the row keeps the retry's live
    // pointer instead of being dragged back to failed.
    await expect(
      service.requestForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
        employeeName: 'Ada Lovelace',
        employeeEmail: 'ada@example.com',
      }),
    ).rejects.toThrow('identity down');

    expect(paymentService.refund).toHaveBeenCalledWith({
      organizationId: 'org_1',
      memberId: 'mem_1',
      paymentIntentId: 'pi_1',
    });
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'bcr_1',
          identityBackgroundCheckId: null,
        }),
      }),
    );
  });

  it('returns the live retry attempt instead of overwriting it on Step 5', async () => {
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>>(
      mockedDb.backgroundCheckRequest.findUnique,
    ).mockResolvedValueOnce(null);
    mockAsync<Awaited<ReturnType<typeof db.member.findFirst>>>(
      mockedDb.member.findFirst,
    ).mockResolvedValueOnce({
      id: 'mem_1',
      organizationId: 'org_1',
    } as Awaited<ReturnType<typeof db.member.findFirst>>);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>>(
      mockedDb.backgroundCheckRequest.create,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      status: 'invited',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>>(
      mockedDb.backgroundCheckRequest.update,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      status: 'invited',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>);
    // A retry swapped in a fresh vendor check while the Checkr create call
    // was in flight: the guarded persist matches nothing.
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>>(
      mockedDb.backgroundCheckRequest.updateMany,
    ).mockResolvedValueOnce({
      count: 0,
    });
    const liveAttempt = {
      id: 'bcr_1',
      status: 'invited',
      identityBackgroundCheckId: 'check_retry',
    };
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>>(
      mockedDb.backgroundCheckRequest.findUnique,
    ).mockResolvedValueOnce(
      liveAttempt as Awaited<
        ReturnType<typeof db.backgroundCheckRequest.findUnique>
      >,
    );

    const identityClient = {
      assertConfigured: jest.fn(),
      assertCreatableInput: jest.fn(),
      createBackgroundCheck: jest.fn().mockResolvedValue({
        id: 'check_stale',
        status: 'invited',
        candidateUrl: null,
      }),
    };
    const paymentService = {
      charge: jest.fn().mockResolvedValue({
        paymentIntentId: 'pi_1',
        status: 'succeeded',
        amount: 1000,
        currency: 'usd',
      }),
      refund: jest.fn(),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      paymentService as unknown as BackgroundCheckPaymentService,
    );

    // The stale attempt's pointer is dropped and the live retry attempt is
    // returned — no refund (the charge backs the live check), no throw.
    const result = await service.requestForMember({
      organizationId: 'org_1',
      memberId: 'mem_1',
      employeeName: 'Ada Lovelace',
      employeeEmail: 'ada@example.com',
    });

    expect(result).toBe(liveAttempt);
    expect(paymentService.refund).not.toHaveBeenCalled();
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'bcr_1',
          identityBackgroundCheckId: null,
        }),
      }),
    );
  });

  it('rethrows the Checkr error when the Step 4 refund itself fails', async () => {
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>>(
      mockedDb.backgroundCheckRequest.findUnique,
    ).mockResolvedValueOnce(null);
    mockAsync<Awaited<ReturnType<typeof db.member.findFirst>>>(
      mockedDb.member.findFirst,
    ).mockResolvedValueOnce({
      id: 'mem_1',
      organizationId: 'org_1',
    } as Awaited<ReturnType<typeof db.member.findFirst>>);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>>(
      mockedDb.backgroundCheckRequest.create,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      status: 'invited',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>>(
      mockedDb.backgroundCheckRequest.update,
    ).mockResolvedValue({
      id: 'bcr_1',
      status: 'failed',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>);
    // The Step 4 failed-mark is guarded on the null pointer so a
    // concurrent retry swap wins over it.
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>>(
      mockedDb.backgroundCheckRequest.updateMany,
    ).mockResolvedValue({
      count: 1,
    });

    const identityClient = {
      assertConfigured: jest.fn(),
      assertCreatableInput: jest.fn(),
      createBackgroundCheck: jest
        .fn()
        .mockRejectedValue(new Error('identity down')),
    };
    const paymentService = {
      charge: jest.fn().mockResolvedValue({
        paymentIntentId: 'pi_1',
        status: 'succeeded',
        amount: 1000,
        currency: 'usd',
      }),
      refund: jest.fn().mockRejectedValue(new Error('stripe down')),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      paymentService as unknown as BackgroundCheckPaymentService,
    );

    // The original Checkr error surfaces — never the refund error — and the
    // failed-mark is still attempted best-effort.
    await expect(
      service.requestForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
        employeeName: 'Ada Lovelace',
        employeeEmail: 'ada@example.com',
      }),
    ).rejects.toThrow('identity down');
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'bcr_1',
          identityBackgroundCheckId: null,
        }),
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('stores internal requester notes on successful requests', async () => {
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>>(
      mockedDb.backgroundCheckRequest.findUnique,
    ).mockResolvedValueOnce(null);
    mockAsync<Awaited<ReturnType<typeof db.member.findFirst>>>(
      mockedDb.member.findFirst,
    ).mockResolvedValueOnce({
      id: 'mem_1',
      organizationId: 'org_1',
    } as Awaited<ReturnType<typeof db.member.findFirst>>);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>>(
      mockedDb.backgroundCheckRequest.create,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      status: 'invited',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>>(
      mockedDb.backgroundCheckRequest.update,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      status: 'invited',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>);
    // The Step 5 persist is guarded on the null pointer so a concurrent
    // retry swap wins over it.
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>>(
      mockedDb.backgroundCheckRequest.updateMany,
    ).mockResolvedValueOnce({
      count: 1,
    });
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>>(
      mockedDb.backgroundCheckRequest.findUnique,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      status: 'invited',
      identityBackgroundCheckId: 'check_1',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);

    const identityClient = {
      assertConfigured: jest.fn(),
      assertCreatableInput: jest.fn(),
      createBackgroundCheck: jest.fn().mockResolvedValue({
        id: 'check_1',
        status: 'invited',
        candidateUrl: 'https://identity.gideondefender.com/cand_1',
      }),
    };
    const paymentService = {
      charge: jest.fn().mockResolvedValue({
        paymentIntentId: 'pi_1',
        status: 'succeeded',
        amount: 4900,
        currency: 'usd',
      }),
      refund: jest.fn(),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      paymentService as unknown as BackgroundCheckPaymentService,
    );

    await service.requestForMember({
      organizationId: 'org_1',
      memberId: 'mem_1',
      employeeName: 'Ada Lovelace',
      employeeEmail: 'ada@example.com',

      requesterNotes: 'Expedite this check.',
    });

    // Record is created with requester notes before charging
    expect(mockedDb.backgroundCheckRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requesterNotes: 'Expedite this check.',
          status: 'invited',
        }),
      }),
    );
    // Payment info is persisted via update
    expect(mockedDb.backgroundCheckRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stripePaymentIntentId: 'pi_1',
        }),
      }),
    );
    // Identity result is persisted via a pointer-guarded updateMany
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'bcr_1',
          identityBackgroundCheckId: null,
        }),
        data: expect.objectContaining({
          identityBackgroundCheckId: 'check_1',
          candidateUrl: 'https://identity.gideondefender.com/cand_1',
        }),
      }),
    );
    // Record is created before Identity API is called
    expect(
      invocationOrder(mockedDb.backgroundCheckRequest.create),
    ).toBeLessThan(invocationOrder(identityClient.createBackgroundCheck));
    expect(identityClient.createBackgroundCheck).toHaveBeenCalledWith(
      expect.not.objectContaining({
        requesterNotes: expect.any(String),
      }),
    );
  });

  it('rejects a mononym before claiming the slot or charging', async () => {
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>>(
      mockedDb.backgroundCheckRequest.findUnique,
    ).mockResolvedValueOnce(null);
    const paymentService = { charge: jest.fn(), refund: jest.fn() };
    const identityClient = {
      assertConfigured: jest.fn(),
      assertCreatableInput: jest.fn().mockImplementation(() => {
        throw new Error('first and last name');
      }),
      createBackgroundCheck: jest.fn(),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      paymentService as unknown as BackgroundCheckPaymentService,
    );

    await expect(
      service.requestForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
        employeeName: 'Madonna',
        employeeEmail: 'madonna@example.com',
      }),
    ).rejects.toThrow('first and last name');

    expect(identityClient.createBackgroundCheck).not.toHaveBeenCalled();
    expect(paymentService.charge).not.toHaveBeenCalled();
    expect(mockedDb.backgroundCheckRequest.create).not.toHaveBeenCalled();
  });

  it('handles concurrent requests by returning existing record on unique constraint', async () => {
    const { Prisma } = jest.requireMock<typeof import('@db')>('@db');
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>>(
      mockedDb.backgroundCheckRequest.findUnique,
    )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'invited',
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
    mockAsync<Awaited<ReturnType<typeof db.member.findFirst>>>(
      mockedDb.member.findFirst,
    ).mockResolvedValueOnce({
      id: 'mem_1',
      organizationId: 'org_1',
    } as Awaited<ReturnType<typeof db.member.findFirst>>);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>>(
      mockedDb.backgroundCheckRequest.create,
    ).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const paymentService = { charge: jest.fn(), refund: jest.fn() };
    const identityClient = {
      assertConfigured: jest.fn(),
      assertCreatableInput: jest.fn(),
      createBackgroundCheck: jest.fn(),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      paymentService as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.requestForMember({
      organizationId: 'org_1',
      memberId: 'mem_1',
      employeeName: 'Ada Lovelace',
      employeeEmail: 'ada@example.com',
    });

    expect(result).toEqual(expect.objectContaining({ id: 'bcr_1' }));
    expect(paymentService.charge).not.toHaveBeenCalled();
    expect(identityClient.createBackgroundCheck).not.toHaveBeenCalled();
  });

  it('uses BETTER_AUTH_URL as the local app URL fallback for setup redirects', async () => {
    process.env.NEXT_PUBLIC_APP_URL = '';
    process.env.APP_URL = '';
    process.env.BETTER_AUTH_URL = 'http://localhost:3000';
    const billingService = {
      createSetupSession: jest.fn().mockResolvedValue({
        url: 'https://checkout.stripe.com/c/session_1',
      }),
    } as unknown as BillingService;
    const service = new BackgroundCheckBillingService(billingService);

    await expect(
      service.createSetupSession({
        organizationId: 'org_1',
        successUrl:
          'http://localhost:3000/org_1/people/mem_1?background_check_billing=success',
        cancelUrl: 'http://localhost:3000/org_1/people/mem_1',
        customerEmail: 'billing@gideondefender.com',
      }),
    ).resolves.toEqual({ url: 'https://checkout.stripe.com/c/session_1' });

    expect(billingService.createSetupSession).toHaveBeenCalledWith({
      organizationId: 'org_1',
      successUrl:
        'http://localhost:3000/org_1/people/mem_1?background_check_billing=success',
      cancelUrl: 'http://localhost:3000/org_1/people/mem_1',
      customerEmail: 'billing@gideondefender.com',
    });
  });

  describe('cancelForMember', () => {
    function makeService() {
      const identityClient = { createBackgroundCheck: jest.fn() };
      const paymentService = { charge: jest.fn(), refund: jest.fn() };
      const service = new BackgroundChecksService(
        identityClient as unknown as CheckrClient,
        paymentService as unknown as BackgroundCheckPaymentService,
      );
      return { service, identityClient, paymentService };
    }

    it('sets status to cancelled for an in_progress check', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'in_progress',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'cancelled',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValueOnce({
        count: 1,
      });

      const { service } = makeService();
      const result = await service.cancelForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
      });

      expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org_1',
            memberId: 'mem_1',
          }),
          data: expect.objectContaining({ status: 'cancelled' }),
        }),
      );
      expect((result as { status: string }).status).toBe('cancelled');
    });

    it('refuses to cancel when the row completed between read and write', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'in_progress',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'completed',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValueOnce({
        count: 0,
      });

      const { service } = makeService();
      await expect(
        service.cancelForMember({ organizationId: 'org_1', memberId: 'mem_1' }),
      ).rejects.toThrow(
        "Cannot cancel a background check in 'completed' status.",
      );
    });

    it('rejects cancelling a completed check', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique).mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'completed',
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      const { service } = makeService();
      await expect(
        service.cancelForMember({ organizationId: 'org_1', memberId: 'mem_1' }),
      ).rejects.toThrow(
        "Cannot cancel a background check in 'completed' status.",
      );
      expect(mockedDb.backgroundCheckRequest.updateMany).not.toHaveBeenCalled();
    });

    it('throws when no check exists', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique).mockResolvedValueOnce(
        null as Awaited<
          ReturnType<typeof db.backgroundCheckRequest.findUnique>
        >,
      );
      const { service } = makeService();
      await expect(
        service.cancelForMember({ organizationId: 'org_1', memberId: 'mem_1' }),
      ).rejects.toThrow('Background check not found.');
    });
  });

  describe('retryForMember', () => {
    it('resubmits a failed check for free with an incremented attempt key', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'failed',
          rerunCount: 1,
          employeeName: 'Ada Lovelace',
          employeeEmail: 'ada@example.com',
          identityBackgroundCheckId: 'check_old',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'failed',
          rerunCount: 1,
          employeeName: 'Ada Lovelace',
          employeeEmail: 'ada@example.com',
          identityBackgroundCheckId: 'check_old',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'invited',
          rerunCount: 2,
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValueOnce({
        count: 1,
      });

      const identityClient = {
        createBackgroundCheck: jest.fn().mockResolvedValue({
          id: 'check_new',
          status: 'invited',
          candidateUrl: 'https://c/x',
        }),
      };
      const paymentService = { charge: jest.fn(), refund: jest.fn() };
      const service = new BackgroundChecksService(
        identityClient as unknown as CheckrClient,
        paymentService as unknown as BackgroundCheckPaymentService,
      );

      await service.retryForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
      });

      expect(paymentService.charge).not.toHaveBeenCalled();
      expect(identityClient.createBackgroundCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          memberId: 'mem_1',
          idempotencyKey: 'comp-background-check:bcr_1:2',
        }),
      );
      expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'failed',
            identityBackgroundCheckId: 'check_old',
          }),
          data: expect.objectContaining({
            identityBackgroundCheckId: 'check_new',
            status: 'invited',
            rerunCount: 2,
            // The superseded pointer is remembered so a late webhook for
            // the prior attempt stays stale instead of rewinding the row.
            supersededIdentityBackgroundCheckIds: { push: 'check_old' },
            // The new attempt is live: the prior refund marker stays behind.
            stripeRefundId: null,
            identityStatus: null,
            reportSnapshot: Prisma.JsonNull,
            reportSyncedAt: null,
          }),
        }),
      );
    });

    it('retries an orphaned invited row that never reached the vendor', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'invited',
          rerunCount: 0,
          employeeName: 'Ada Lovelace',
          employeeEmail: 'ada@example.com',
          identityBackgroundCheckId: null,
          stripePaymentIntentId: 'pi_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'invited',
          rerunCount: 0,
          employeeName: 'Ada Lovelace',
          employeeEmail: 'ada@example.com',
          identityBackgroundCheckId: null,
          stripePaymentIntentId: 'pi_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'invited',
          rerunCount: 1,
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValueOnce({
        count: 1,
      });

      const identityClient = {
        createBackgroundCheck: jest.fn().mockResolvedValue({
          id: 'check_new',
          status: 'invited',
          candidateUrl: null,
        }),
      };
      const service = new BackgroundChecksService(
        identityClient as unknown as CheckrClient,
        {} as unknown as BackgroundCheckPaymentService,
      );

      await service.retryForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
      });

      expect(identityClient.createBackgroundCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'comp-background-check:bcr_1:1',
        }),
      );
    });

    it('rejects retrying an invited row that already has a vendor pointer', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique).mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'invited',
        rerunCount: 0,
        identityBackgroundCheckId: 'inv_1',
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      const identityClient = { createBackgroundCheck: jest.fn() };
      const service = new BackgroundChecksService(
        identityClient as unknown as CheckrClient,
        {} as unknown as BackgroundCheckPaymentService,
      );
      await expect(
        service.retryForMember({
          organizationId: 'org_1',
          memberId: 'mem_1',
        }),
      ).rejects.toThrow("Cannot retry a background check in 'invited' status.");
      expect(identityClient.createBackgroundCheck).not.toHaveBeenCalled();
    });

    it('rejects a free retry for an orphaned invited row that never paid', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique).mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'invited',
        rerunCount: 0,
        employeeName: 'Ada Lovelace',
        employeeEmail: 'ada@example.com',
        identityBackgroundCheckId: null,
        stripePaymentIntentId: null,
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      const identityClient = { createBackgroundCheck: jest.fn() };
      const service = new BackgroundChecksService(
        identityClient as unknown as CheckrClient,
        {} as unknown as BackgroundCheckPaymentService,
      );
      await expect(
        service.retryForMember({
          organizationId: 'org_1',
          memberId: 'mem_1',
        }),
      ).rejects.toThrow('has no payment');
      expect(identityClient.createBackgroundCheck).not.toHaveBeenCalled();
    });

    it('rejects retrying an in_progress check', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique).mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'in_progress',
        rerunCount: 0,
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      const identityClient = { createBackgroundCheck: jest.fn() };
      const service = new BackgroundChecksService(
        identityClient as unknown as CheckrClient,
        {} as unknown as BackgroundCheckPaymentService,
      );
      await expect(
        service.retryForMember({
          organizationId: 'org_1',
          memberId: 'mem_1',
        }),
      ).rejects.toThrow(
        "Cannot retry a background check in 'in_progress' status.",
      );
      expect(identityClient.createBackgroundCheck).not.toHaveBeenCalled();
    });

    it('keeps a cancelled check cancelled (no resurrection) and rethrows when Identity errors', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'cancelled',
          rerunCount: 0,
          employeeName: 'Ada',
          employeeEmail: 'ada@example.com',
          identityBackgroundCheckId: 'check_old',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'cancelled',
          rerunCount: 0,
          employeeName: 'Ada',
          employeeEmail: 'ada@example.com',
          identityBackgroundCheckId: 'check_old',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValue({
        count: 1,
      });
      const identityClient = {
        createBackgroundCheck: jest
          .fn()
          .mockRejectedValue(new Error('identity down')),
      };
      const service = new BackgroundChecksService(
        identityClient as unknown as CheckrClient,
        {
          charge: jest.fn(),
          refund: jest.fn(),
        } as unknown as BackgroundCheckPaymentService,
      );

      await expect(
        service.retryForMember({
          organizationId: 'org_1',
          memberId: 'mem_1',
        }),
      ).rejects.toThrow('identity down');
      expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            identityBackgroundCheckId: 'check_old',
          }),
          data: expect.objectContaining({ status: 'cancelled' }),
        }),
      );
    });

    it('guards the failure restore with the status so a concurrent cancel wins', async () => {
      const orphan = {
        id: 'bcr_1',
        status: 'invited',
        rerunCount: 0,
        employeeName: 'Ada',
        employeeEmail: 'ada@example.com',
        identityBackgroundCheckId: null,
        stripePaymentIntentId: 'pi_1',
      };
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce(
          orphan as Awaited<
            ReturnType<typeof db.backgroundCheckRequest.findUnique>
          >,
        )
        .mockResolvedValueOnce(
          orphan as Awaited<
            ReturnType<typeof db.backgroundCheckRequest.findUnique>
          >,
        );
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValue({
        count: 1,
      });
      const identityClient = {
        createBackgroundCheck: jest
          .fn()
          .mockRejectedValue(new Error('identity down')),
      };
      const service = new BackgroundChecksService(
        identityClient as unknown as CheckrClient,
        {
          charge: jest.fn(),
          refund: jest.fn(),
        } as unknown as BackgroundCheckPaymentService,
      );

      await expect(
        service.retryForMember({
          organizationId: 'org_1',
          memberId: 'mem_1',
        }),
      ).rejects.toThrow('identity down');
      // Cancel never touches the vendor pointer, so the pointer-only guard
      // would still match a concurrently cancelled row and resurrect it to
      // invited. The status predicate keeps the terminal cancel.
      expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'invited',
            identityBackgroundCheckId: null,
          }),
          data: expect.objectContaining({ status: 'invited' }),
        }),
      );
    });

    it('refuses to create a vendor check when the row moved before the write', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'failed',
          rerunCount: 1,
          employeeName: 'Ada',
          employeeEmail: 'ada@example.com',
          identityBackgroundCheckId: 'check_old',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'in_progress',
          rerunCount: 2,
          employeeName: 'Ada',
          employeeEmail: 'ada@example.com',
          identityBackgroundCheckId: 'check_new',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      const identityClient = { createBackgroundCheck: jest.fn() };
      const service = new BackgroundChecksService(
        identityClient as unknown as CheckrClient,
        {} as unknown as BackgroundCheckPaymentService,
      );

      // A concurrent retry already swapped in a fresh check: this attempt
      // stops before issuing another vendor write.
      await expect(
        service.retryForMember({
          organizationId: 'org_1',
          memberId: 'mem_1',
        }),
      ).rejects.toThrow('changed while retrying');
      expect(identityClient.createBackgroundCheck).not.toHaveBeenCalled();
    });

    it('throws when no check exists', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique).mockResolvedValueOnce(
        null as Awaited<
          ReturnType<typeof db.backgroundCheckRequest.findUnique>
        >,
      );
      const identityClient = { createBackgroundCheck: jest.fn() };
      const service = new BackgroundChecksService(
        identityClient as unknown as CheckrClient,
        {} as unknown as BackgroundCheckPaymentService,
      );
      await expect(
        service.retryForMember({
          organizationId: 'org_1',
          memberId: 'mem_1',
        }),
      ).rejects.toThrow('Background check not found.');
      expect(identityClient.createBackgroundCheck).not.toHaveBeenCalled();
    });
  });

  describe('deleteForMember', () => {
    it('hard-deletes an existing check', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique).mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'failed',
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.delete>>>(
        mockedDb.backgroundCheckRequest.delete,
      ).mockResolvedValueOnce({ id: 'bcr_1' } as Awaited<
        ReturnType<typeof db.backgroundCheckRequest.delete>
      >);

      const service = new BackgroundChecksService(
        {} as unknown as CheckrClient,
        {} as unknown as BackgroundCheckPaymentService,
      );
      const result = await service.deleteForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
      });

      expect(mockedDb.backgroundCheckRequest.delete).toHaveBeenCalledWith({
        where: {
          organizationId_memberId: {
            organizationId: 'org_1',
            memberId: 'mem_1',
          },
        },
      });
      expect(result).toEqual({ ok: true });
    });

    it('throws when no check exists', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique).mockResolvedValueOnce(
        null as Awaited<
          ReturnType<typeof db.backgroundCheckRequest.findUnique>
        >,
      );
      const service = new BackgroundChecksService(
        {} as unknown as CheckrClient,
        {} as unknown as BackgroundCheckPaymentService,
      );
      await expect(
        service.deleteForMember({ organizationId: 'org_1', memberId: 'mem_1' }),
      ).rejects.toThrow('Background check not found.');
      expect(mockedDb.backgroundCheckRequest.delete).not.toHaveBeenCalled();
    });
  });

  it('includes background check and penetration test usage in billing status', async () => {
    const billingService = {
      getStatus: jest.fn().mockResolvedValue({
        hasBilling: true,
        hasPaymentMethod: true,
        setupAt: new Date('2026-04-29T12:00:00.000Z'),
        usage: { backgroundChecks: 4, penetrationTests: 2 },
        subscriptions: [],
        invoices: [
          {
            id: 'in_1',
            number: 'INV-001',
            createdAt: '2026-04-30T00:00:00.000Z',
            dueDate: null,
            amountPaid: 4900,
            amountDue: 4900,
            currency: 'usd',
            status: 'paid',
            type: 'One Time',
            hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_1',
            invoicePdfUrl: 'https://invoice.stripe.com/i/in_1.pdf',
          },
        ],
      }),
    } as unknown as BillingService;
    const service = new BackgroundCheckBillingService(billingService);

    await expect(service.getStatus('org_1')).resolves.toMatchObject({
      hasBilling: true,
      hasPaymentMethod: true,
      usage: {
        backgroundChecks: 4,
        penetrationTests: 2,
      },
      invoices: [
        {
          id: 'in_1',
          number: 'INV-001',
          amountPaid: 4900,
          status: 'paid',
          type: 'One Time',
        },
      ],
    });
    expect(billingService.getStatus).toHaveBeenCalledWith('org_1');
  });

  describe('getById', () => {
    function makeService(identityClient: unknown) {
      return new BackgroundChecksService(
        identityClient as CheckrClient,
        {} as unknown as BackgroundCheckPaymentService,
      );
    }

    it('returns the record alone when no Checkr report is linked', async () => {
      const record = { id: 'bcr_1', identityBackgroundCheckId: null };
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>
      >(mockedDb.backgroundCheckRequest.findFirst).mockResolvedValueOnce(
        record as Awaited<
          ReturnType<typeof db.backgroundCheckRequest.findFirst>
        >,
      );
      const identityClient = { getReport: jest.fn() };
      const result = await makeService(identityClient).getById({
        organizationId: 'org_1',
        id: 'bcr_1',
      });

      expect(result).toEqual({ record });
      expect(identityClient.getReport).not.toHaveBeenCalled();
    });

    it('fetches the Checkr report when linked and configured', async () => {
      const record = { id: 'bcr_1', identityBackgroundCheckId: 'rep_1' };
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>
      >(mockedDb.backgroundCheckRequest.findFirst).mockResolvedValueOnce(
        record as Awaited<
          ReturnType<typeof db.backgroundCheckRequest.findFirst>
        >,
      );
      const identityClient = {
        getReport: jest.fn().mockResolvedValue({ id: 'rep_1' }),
      };
      const result = await makeService(identityClient).getById({
        organizationId: 'org_1',
        id: 'rep_1',
      });

      expect(identityClient.getReport).toHaveBeenCalledWith('rep_1');
      expect(result).toEqual({ record, identity: { id: 'rep_1' } });
    });

    it('degrades to the stored record when the vendor is unreachable', async () => {
      const record = { id: 'bcr_1', identityBackgroundCheckId: 'rep_1' };
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>
      >(mockedDb.backgroundCheckRequest.findFirst).mockResolvedValueOnce(
        record as Awaited<
          ReturnType<typeof db.backgroundCheckRequest.findFirst>
        >,
      );
      const identityClient = {
        getReport: jest.fn().mockRejectedValue(new Error('socket hang up')),
      };
      const result = await makeService(identityClient).getById({
        organizationId: 'org_1',
        id: 'rep_1',
      });

      expect(result).toEqual({ record });
    });

    it('surfaces invalid credentials instead of degrading', async () => {
      const record = { id: 'bcr_1', identityBackgroundCheckId: 'rep_1' };
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>
      >(mockedDb.backgroundCheckRequest.findFirst).mockResolvedValueOnce(
        record as Awaited<
          ReturnType<typeof db.backgroundCheckRequest.findFirst>
        >,
      );
      const identityClient = {
        getReport: jest
          .fn()
          .mockRejectedValue(
            new UnauthorizedException('Checkr credentials are invalid.'),
          ),
      };
      await expect(
        makeService(identityClient).getById({
          organizationId: 'org_1',
          id: 'rep_1',
        }),
      ).rejects.toThrow('Checkr credentials are invalid.');
    });

    it('throws when no record matches', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>
      >(mockedDb.backgroundCheckRequest.findFirst).mockResolvedValueOnce(null);
      await expect(
        makeService({ getReport: jest.fn() }).getById({
          organizationId: 'org_1',
          id: 'missing',
        }),
      ).rejects.toThrow('Background check not found.');
    });

    it('prefers invitation-aware resolution so invited rows read their report', async () => {
      const record = {
        id: 'bcr_1',
        identityBackgroundCheckId: 'inv_1',
        checkrInvitationId: 'inv_1',
      };
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>
      >(mockedDb.backgroundCheckRequest.findFirst).mockResolvedValueOnce(
        record as Awaited<
          ReturnType<typeof db.backgroundCheckRequest.findFirst>
        >,
      );
      const report = { id: 'rep_1', status: 'pending' };
      const identityClient = {
        getReport: jest.fn(),
        resolveReport: jest
          .fn()
          .mockResolvedValue({ report, reportId: 'rep_1' }),
      };
      const result = await makeService(identityClient).getById({
        organizationId: 'org_1',
        id: 'bcr_1',
      });

      expect(identityClient.resolveReport).toHaveBeenCalledWith({
        reportId: 'inv_1',
        invitationId: 'inv_1',
      });
      expect(identityClient.getReport).not.toHaveBeenCalled();
      expect(result).toEqual({ record, identity: report });
    });
  });

  describe('syncForMember', () => {
    function makeService(identityClient: unknown) {
      return new BackgroundChecksService(
        identityClient as CheckrClient,
        {} as unknown as BackgroundCheckPaymentService,
      );
    }

    it('persists the latest Checkr status and returns the sync payload', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'in_progress',
          identityBackgroundCheckId: 'rep_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'completed',
          identityBackgroundCheckId: 'rep_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValueOnce({
        count: 1,
      });
      const identityClient = {
        getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
      };

      const result = await makeService(identityClient).syncForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
      });

      // The write itself carries the non-terminal predicate: a concurrent
      // terminalization between the vendor read and the write loses the
      // race instead of being clobbered.
      expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org_1',
            memberId: 'mem_1',
            status: { notIn: expect.arrayContaining(['completed']) },
          }),
          data: expect.objectContaining({
            status: 'completed',
            lastSyncedAt: expect.any(Date),
          }),
        }),
      );
      expect(result.syncedAt).toEqual(expect.any(String));
      expect(result.identity).toEqual({ status: 'clear' });
    });

    it('throws when no Checkr check is linked', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique).mockResolvedValueOnce({
        id: 'bcr_1',
        identityBackgroundCheckId: null,
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);

      await expect(
        makeService({ getReport: jest.fn() }).syncForMember({
          organizationId: 'org_1',
          memberId: 'mem_1',
        }),
      ).rejects.toThrow('No background check to sync.');
    });

    it('backs off on unrecognized Checkr statuses without changing status', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'in_progress',
          identityBackgroundCheckId: 'rep_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'in_progress',
          identityBackgroundCheckId: 'rep_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValueOnce({
        count: 1,
      });
      const identityClient = {
        getReport: jest.fn().mockResolvedValue({ status: 'frobnicated' }),
      };

      const result = await makeService(identityClient).syncForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
      });

      // Touches the timestamp so reconcile backs off, leaves status alone
      expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { lastSyncedAt: expect.any(Date) },
        }),
      );
      const updateData = (
        mockedDb.backgroundCheckRequest.updateMany as jest.Mock
      ).mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('status');
      expect(result.syncedAt).toEqual(expect.any(String));
      expect(result.identity).toEqual({ status: 'frobnicated' });
    });

    it('returns the record untouched when no report exists yet', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'invited',
          identityBackgroundCheckId: 'cand_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'invited',
          identityBackgroundCheckId: 'cand_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValueOnce({
        count: 1,
      });
      const identityClient = {
        getReport: jest.fn().mockResolvedValue(null),
      };

      const result = await makeService(identityClient).syncForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
      });

      expect(identityClient.getReport).toHaveBeenCalledWith('cand_1');
      expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { lastSyncedAt: expect.any(Date) },
        }),
      );
      expect(result.syncedAt).toEqual(expect.any(String));
    });

    it('leaves terminal rows with a snapshot untouched without calling Checkr', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique).mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'completed',
        identityBackgroundCheckId: 'rep_1',
        reportSnapshot: { id: 'rep_1' },
      } as unknown as Awaited<
        ReturnType<typeof db.backgroundCheckRequest.findUnique>
      >);
      mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>>(
        mockedDb.backgroundCheckRequest.update,
      ).mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'completed',
        identityBackgroundCheckId: 'rep_1',
        reportSnapshot: { id: 'rep_1' },
      } as unknown as Awaited<
        ReturnType<typeof db.backgroundCheckRequest.update>
      >);
      const identityClient = {
        getReport: jest.fn(),
      };

      const result = await makeService(identityClient).syncForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
      });

      expect(identityClient.getReport).not.toHaveBeenCalled();
      // Frozen rows only refresh the sync timestamp so `syncedAt` stays
      // truthful; status and snapshot are untouched.
      expect(mockedDb.backgroundCheckRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { lastSyncedAt: expect.any(Date) },
        }),
      );
      expect(result.record).toEqual(
        expect.objectContaining({ status: 'completed' }),
      );
      expect(result.syncedAt).toEqual(expect.any(String));
    });

    it('backfills a missing snapshot on terminal rows without changing status', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'completed',
          identityBackgroundCheckId: 'rep_1',
          reportSnapshot: null,
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'completed',
          identityBackgroundCheckId: 'rep_1',
          reportSnapshot: { id: 'rep_1', status: 'clear' },
          organizationId: 'org_1',
          memberId: 'mem_1',
          employeeEmail: 'ada@example.com',
          employeeName: 'Ada',
        } as unknown as Awaited<
          ReturnType<typeof db.backgroundCheckRequest.findUnique>
        >);
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValueOnce({
        count: 1,
      });
      const identityClient = {
        getReport: jest
          .fn()
          .mockResolvedValue({ id: 'rep_1', status: 'clear' }),
      };

      const result = await makeService(identityClient).syncForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
      });

      expect(identityClient.getReport).toHaveBeenCalledWith('rep_1');
      // Guarded write: a concurrent retry must not lose the row to a stale
      // backfill, so the status and pointer ride in the predicate.
      expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org_1',
            memberId: 'mem_1',
            status: 'completed',
            identityBackgroundCheckId: 'rep_1',
          }),
          data: expect.objectContaining({
            reportSnapshot: { id: 'rep_1', status: 'clear' },
            reportSyncedAt: expect.any(Date),
          }),
        }),
      );
      const updateData = (
        mockedDb.backgroundCheckRequest.updateMany as jest.Mock
      ).mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('status');
      expect(mockedDb.backgroundCheckRequest.update).not.toHaveBeenCalled();
      expect(result.syncedAt).toEqual(expect.any(String));
    });

    it('returns the fresh row unwritten when a retry swaps the attempt mid-backfill', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'completed',
          identityBackgroundCheckId: 'rep_1',
          reportSnapshot: null,
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'invited',
          identityBackgroundCheckId: 'inv_9',
          reportSnapshot: null,
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      // The retry moved the row: status and pointer no longer match, so the
      // guarded backfill writes nothing.
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValueOnce({
        count: 0,
      });
      const identityClient = {
        getReport: jest
          .fn()
          .mockResolvedValue({ id: 'rep_1', status: 'clear' }),
      };

      const result = await makeService(identityClient).syncForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
      });

      // The old check's snapshot must not land on the new attempt: no plain
      // update runs, and the caller sees the fresh row.
      expect(mockedDb.backgroundCheckRequest.update).not.toHaveBeenCalled();
      expect(result.record).toEqual(
        expect.objectContaining({
          status: 'invited',
          identityBackgroundCheckId: 'inv_9',
        }),
      );
      expect(result.syncedAt).toEqual(expect.any(String));
    });

    it('backs off when Checkr is unreachable instead of failing sync', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'in_progress',
          identityBackgroundCheckId: 'rep_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'in_progress',
          identityBackgroundCheckId: 'rep_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValueOnce({
        count: 1,
      });
      const identityClient = {
        getReport: jest.fn().mockRejectedValue(new Error('socket hang up')),
      };

      const result = await makeService(identityClient).syncForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
      });

      expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { lastSyncedAt: expect.any(Date) },
        }),
      );
      const updateData = (
        mockedDb.backgroundCheckRequest.updateMany as jest.Mock
      ).mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('status');
      expect(result.syncedAt).toEqual(expect.any(String));
    });

    it('graduates an invitation-id pointer once the report exists', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'invited',
          identityBackgroundCheckId: 'inv_1',
          checkrInvitationId: 'inv_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'completed',
          identityBackgroundCheckId: 'rep_9',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValueOnce({
        count: 1,
      });
      const identityClient = {
        resolveReport: jest.fn().mockResolvedValue({
          report: { status: 'clear' },
          reportId: 'rep_9',
        }),
        getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
      };

      const result = await makeService(identityClient).syncForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
      });

      expect(identityClient.resolveReport).toHaveBeenCalledWith({
        reportId: 'inv_1',
        invitationId: 'inv_1',
      });
      expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            identityBackgroundCheckId: 'rep_9',
            status: 'completed',
          }),
        }),
      );
      expect(result.identity).toEqual({ status: 'clear' });
    });

    it('marks an invited row failed when its invitation expired', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'invited',
          identityBackgroundCheckId: 'inv_1',
          checkrInvitationId: 'inv_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'failed',
          identityBackgroundCheckId: 'inv_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValueOnce({
        count: 1,
      });
      const identityClient = {
        resolveReport: jest
          .fn()
          .mockResolvedValue({ report: null, reportId: 'inv_1' }),
        getInvitation: jest
          .fn()
          .mockResolvedValue({ id: 'inv_1', status: 'expired' }),
      };

      await makeService(identityClient).syncForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
      });

      expect(identityClient.getInvitation).toHaveBeenCalledWith('inv_1');
      expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed' }),
        }),
      );
    });

    it('surfaces invalid credentials instead of backing off', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique).mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'in_progress',
        identityBackgroundCheckId: 'rep_1',
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      const identityClient = {
        resolveReport: jest
          .fn()
          .mockRejectedValue(
            new UnauthorizedException('Checkr credentials are invalid.'),
          ),
      };

      await expect(
        makeService(identityClient).syncForMember({
          organizationId: 'org_1',
          memberId: 'mem_1',
        }),
      ).rejects.toThrow('Checkr credentials are invalid.');
      expect(mockedDb.backgroundCheckRequest.update).not.toHaveBeenCalled();
    });

    it('surfaces missing configuration instead of succeeding with no identity', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique).mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'in_progress',
        identityBackgroundCheckId: 'rep_1',
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      const identityClient = {
        resolveReport: jest
          .fn()
          .mockRejectedValue(
            new BadRequestException(
              'Background check service is not configured.',
            ),
          ),
      };

      // A missing key never heals by waiting: the operator must see the
      // 400, not a success with `identity: null` and a touched timestamp.
      await expect(
        makeService(identityClient).syncForMember({
          organizationId: 'org_1',
          memberId: 'mem_1',
        }),
      ).rejects.toThrow('is not configured');
      expect(mockedDb.backgroundCheckRequest.updateMany).not.toHaveBeenCalled();
    });

    it('freezes a row that terminalized mid-sync instead of regressing it', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'in_progress',
          identityBackgroundCheckId: 'rep_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'completed',
          identityBackgroundCheckId: 'rep_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValueOnce({
        count: 0,
      });
      mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>>(
        mockedDb.backgroundCheckRequest.update,
      ).mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'completed',
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>);
      const identityClient = {
        getReport: jest.fn().mockResolvedValue({ status: 'pending' }),
      };

      const result = await makeService(identityClient).syncForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
      });

      // The concurrent terminal state wins: only the timestamp advances,
      // the stale in_progress mapping never overwrites completed.
      expect(mockedDb.backgroundCheckRequest.update).toHaveBeenCalledTimes(1);
      const updateData = (mockedDb.backgroundCheckRequest.update as jest.Mock)
        .mock.calls[0][0].data;
      expect(updateData).toEqual({ lastSyncedAt: expect.any(Date) });
      expect(result.record).toEqual(
        expect.objectContaining({ status: 'completed' }),
      );
      expect(result.syncedAt).toEqual(expect.any(String));
    });

    it('guards the sync write with the vendor pointer so a retry swap wins', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'in_progress',
          identityBackgroundCheckId: 'rep_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'completed',
          identityBackgroundCheckId: 'rep_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValueOnce({
        count: 1,
      });
      const identityClient = {
        getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
      };

      await makeService(identityClient).syncForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
      });

      // The pointer rides in the predicate alongside the status: a retry
      // that swaps in a fresh check between the vendor read and the write
      // loses nothing to this stale attempt.
      expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org_1',
            memberId: 'mem_1',
            status: { notIn: expect.arrayContaining(['completed']) },
            identityBackgroundCheckId: 'rep_1',
          }),
        }),
      );
    });

    it('throws a retryable error when a retry swaps the pointer mid-sync', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'in_progress',
          identityBackgroundCheckId: 'rep_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'in_progress',
          identityBackgroundCheckId: 'rep_2',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      // A concurrent retry swapped rep_1 for rep_2: the guarded write
      // matches nothing, and the fresh row is still in flight.
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValueOnce({
        count: 0,
      });
      const identityClient = {
        getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
      };

      await expect(
        makeService(identityClient).syncForMember({
          organizationId: 'org_1',
          memberId: 'mem_1',
        }),
      ).rejects.toThrow('changed while syncing');
    });

    it('backs off without writing when the report snapshot is unavailable', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'in_progress',
          identityBackgroundCheckId: 'rep_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>)
        .mockResolvedValueOnce({
          id: 'bcr_1',
          status: 'in_progress',
          identityBackgroundCheckId: 'rep_1',
        } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValueOnce({
        count: 1,
      });
      // Terminal status, but the snapshot fetch blows up (vendor blip):
      // the status must wait for the next attempt, not commit snapshot-less.
      const identityClient = {
        getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
        resolveReport: jest.fn().mockResolvedValue({
          report: { status: 'clear' },
          reportId: 'rep_1',
        }),
      };
      identityClient.getReport.mockRejectedValueOnce(new Error('blip'));

      const result = await makeService(identityClient).syncForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
      });

      expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { lastSyncedAt: expect.any(Date) },
        }),
      );
      const backoffData = (
        mockedDb.backgroundCheckRequest.updateMany as jest.Mock
      ).mock.calls[0][0].data;
      expect(backoffData).not.toHaveProperty('status');
      expect(result.syncedAt).toEqual(expect.any(String));
    });
  });

  describe('requestForMember Checkr persistence', () => {
    it('stores native Checkr ids alongside the report id', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique).mockResolvedValueOnce(null);
      mockAsync<Awaited<ReturnType<typeof db.member.findFirst>>>(
        mockedDb.member.findFirst,
      ).mockResolvedValueOnce({
        id: 'mem_1',
        organizationId: 'org_1',
      } as Awaited<ReturnType<typeof db.member.findFirst>>);
      mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>>(
        mockedDb.backgroundCheckRequest.create,
      ).mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'invited',
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>);
      mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>>(
        mockedDb.backgroundCheckRequest.update,
      ).mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'invited',
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>);
      // The Step 5 persist is guarded on the null pointer so a concurrent
      // retry swap wins over it.
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany).mockResolvedValueOnce({
        count: 1,
      });
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique).mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'invited',
        identityBackgroundCheckId: 'cand_1',
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>);

      const identityClient = {
        assertConfigured: jest.fn(),
        assertCreatableInput: jest.fn(),
        createBackgroundCheck: jest.fn().mockResolvedValue({
          id: 'cand_1',
          status: 'invited',
          candidateUrl: 'https://checkr.com/invite',
          candidateId: 'cand_1',
          invitationId: 'inv_1',
        }),
      };
      const paymentService = {
        charge: jest.fn().mockResolvedValue({
          paymentIntentId: 'pi_1',
          status: 'succeeded',
          amount: 4900,
          currency: 'usd',
        }),
        refund: jest.fn(),
      };
      const service = new BackgroundChecksService(
        identityClient as unknown as CheckrClient,
        paymentService as unknown as BackgroundCheckPaymentService,
      );

      await service.requestForMember({
        organizationId: 'org_1',
        memberId: 'mem_1',
        employeeName: 'Ada Lovelace',
        employeeEmail: 'ada@example.com',
      });

      expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'bcr_1',
            identityBackgroundCheckId: null,
          }),
          data: expect.objectContaining({
            identityBackgroundCheckId: 'cand_1',
            checkrCandidateId: 'cand_1',
            checkrInvitationId: 'inv_1',
          }),
        }),
      );
    });

    it('refunds and marks the row failed when persisting the Checkr result fails', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique).mockResolvedValueOnce(null);
      mockAsync<Awaited<ReturnType<typeof db.member.findFirst>>>(
        mockedDb.member.findFirst,
      ).mockResolvedValueOnce({
        id: 'mem_1',
        organizationId: 'org_1',
      } as Awaited<ReturnType<typeof db.member.findFirst>>);
      mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>>(
        mockedDb.backgroundCheckRequest.create,
      ).mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'invited',
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>);
      const persistError = new Error('Step 5 write failed');
      mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>>(
        mockedDb.backgroundCheckRequest.update,
      ).mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'invited',
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>);
      // The Step 5 persist throws; the Step 5 failed-mark is guarded on
      // the null pointer so a concurrent retry swap wins over it.
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.updateMany>>
      >(mockedDb.backgroundCheckRequest.updateMany)
        .mockRejectedValueOnce(persistError)
        .mockResolvedValueOnce({
          count: 1,
        });

      const identityClient = {
        assertConfigured: jest.fn(),
        assertCreatableInput: jest.fn(),
        createBackgroundCheck: jest.fn().mockResolvedValue({
          id: 'cand_1',
          status: 'invited',
          candidateUrl: 'https://checkr.com/invite',
          candidateId: 'cand_1',
          invitationId: 'inv_1',
        }),
      };
      const paymentService = {
        charge: jest.fn().mockResolvedValue({
          paymentIntentId: 'pi_1',
          status: 'succeeded',
          amount: 4900,
          currency: 'usd',
        }),
        refund: jest.fn().mockResolvedValue('re_1'),
      };
      const service = new BackgroundChecksService(
        identityClient as unknown as CheckrClient,
        paymentService as unknown as BackgroundCheckPaymentService,
      );

      await expect(
        service.requestForMember({
          organizationId: 'org_1',
          memberId: 'mem_1',
          employeeName: 'Ada Lovelace',
          employeeEmail: 'ada@example.com',
        }),
      ).rejects.toThrow('Step 5 write failed');

      // Best-effort compensation: refund the captured payment, then mark
      // the paid-but-pointer-less row failed instead of leaving an orphan.
      expect(paymentService.refund).toHaveBeenCalledWith({
        organizationId: 'org_1',
        memberId: 'mem_1',
        paymentIntentId: 'pi_1',
      });
      expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'bcr_1',
            identityBackgroundCheckId: null,
          }),
          data: expect.objectContaining({
            status: 'failed',
            stripeRefundId: 're_1',
            lastSyncedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('rolls back the slot claim when the charge fails', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique).mockResolvedValueOnce(null);
      mockAsync<Awaited<ReturnType<typeof db.member.findFirst>>>(
        mockedDb.member.findFirst,
      ).mockResolvedValueOnce({
        id: 'mem_1',
        organizationId: 'org_1',
      } as Awaited<ReturnType<typeof db.member.findFirst>>);
      mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>>(
        mockedDb.backgroundCheckRequest.create,
      ).mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'invited',
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>);
      mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.delete>>>(
        mockedDb.backgroundCheckRequest.delete,
      ).mockResolvedValueOnce(
        {} as Awaited<ReturnType<typeof db.backgroundCheckRequest.delete>>,
      );

      const chargeError = new Error('card declined');
      const identityClient = {
        assertConfigured: jest.fn(),
        assertCreatableInput: jest.fn(),
        createBackgroundCheck: jest.fn(),
      };
      const paymentService = {
        charge: jest.fn().mockRejectedValue(chargeError),
        refund: jest.fn(),
      };
      const service = new BackgroundChecksService(
        identityClient as unknown as CheckrClient,
        paymentService as unknown as BackgroundCheckPaymentService,
      );

      await expect(
        service.requestForMember({
          organizationId: 'org_1',
          memberId: 'mem_1',
          employeeName: 'Ada Lovelace',
          employeeEmail: 'ada@example.com',
        }),
      ).rejects.toThrow('card declined');

      // No payment moved, so no refund — but the claim must go, or the
      // lingering payment-less row would qualify for a free orphan retry.
      expect(paymentService.refund).not.toHaveBeenCalled();
      expect(identityClient.createBackgroundCheck).not.toHaveBeenCalled();
      expect(mockedDb.backgroundCheckRequest.delete).toHaveBeenCalledWith({
        where: { id: 'bcr_1' },
      });
    });

    it('refunds and removes the row when persisting the payment fails', async () => {
      mockAsync<
        Awaited<ReturnType<typeof db.backgroundCheckRequest.findUnique>>
      >(mockedDb.backgroundCheckRequest.findUnique).mockResolvedValueOnce(null);
      mockAsync<Awaited<ReturnType<typeof db.member.findFirst>>>(
        mockedDb.member.findFirst,
      ).mockResolvedValueOnce({
        id: 'mem_1',
        organizationId: 'org_1',
      } as Awaited<ReturnType<typeof db.member.findFirst>>);
      mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>>(
        mockedDb.backgroundCheckRequest.create,
      ).mockResolvedValueOnce({
        id: 'bcr_1',
        status: 'invited',
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.create>>);
      const persistError = new Error('Step 3 write failed');
      mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.update>>>(
        mockedDb.backgroundCheckRequest.update,
      ).mockRejectedValueOnce(persistError);
      mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.delete>>>(
        mockedDb.backgroundCheckRequest.delete,
      ).mockResolvedValueOnce(
        {} as Awaited<ReturnType<typeof db.backgroundCheckRequest.delete>>,
      );

      const identityClient = {
        assertConfigured: jest.fn(),
        assertCreatableInput: jest.fn(),
        createBackgroundCheck: jest.fn(),
      };
      const paymentService = {
        charge: jest.fn().mockResolvedValue({
          paymentIntentId: 'pi_1',
          status: 'succeeded',
          amount: 4900,
          currency: 'usd',
        }),
        refund: jest.fn().mockResolvedValue('re_1'),
      };
      const service = new BackgroundChecksService(
        identityClient as unknown as CheckrClient,
        paymentService as unknown as BackgroundCheckPaymentService,
      );

      await expect(
        service.requestForMember({
          organizationId: 'org_1',
          memberId: 'mem_1',
          employeeName: 'Ada Lovelace',
          employeeEmail: 'ada@example.com',
        }),
      ).rejects.toThrow('Step 3 write failed');

      // The captured payment goes back, and the payment-less row is removed
      // so the free orphan retry cannot heal it.
      expect(paymentService.refund).toHaveBeenCalledWith({
        organizationId: 'org_1',
        memberId: 'mem_1',
        paymentIntentId: 'pi_1',
      });
      expect(identityClient.createBackgroundCheck).not.toHaveBeenCalled();
      expect(mockedDb.backgroundCheckRequest.delete).toHaveBeenCalledWith({
        where: { id: 'bcr_1' },
      });
    });
  });
});
