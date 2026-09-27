import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { db, Prisma } from '@db';
import { createHmac } from 'node:crypto';
import { CheckrClient } from './checkr.client';
import { BackgroundCheckPaymentService } from './background-check-payment.service';
import { BackgroundChecksService } from './background-checks.service';

jest.mock('@db', () => {
  class PrismaClientKnownRequestError extends Error {
    code: string;

    constructor(message: string, options: { code: string }) {
      super(message);
      this.code = options.code;
    }
  }

  const request = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const events = {
    create: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  };

  return {
    Prisma: { PrismaClientKnownRequestError },
    BackgroundCheckStatus: { cancelled: 'cancelled' },
    db: {
      backgroundCheckRequest: request,
      backgroundCheckWebhookEvent: events,
      // Run interactive transactions against the same mocks so the
      // terminal re-read and the guarded update stay observable.
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({
          backgroundCheckRequest: {
            findUnique: request.findUnique,
            update: request.update,
            updateMany: request.updateMany,
          },
          backgroundCheckWebhookEvent: {
            findUnique: events.findUnique,
            updateMany: events.updateMany,
          },
        }),
    },
  };
});

const mockedDb = db as jest.Mocked<typeof db>;

function mockAsync<T>(fn: unknown): jest.MockedFunction<() => Promise<T>> {
  return fn as jest.MockedFunction<() => Promise<T>>;
}

/** Mock the transactional re-read inside processWebhookEvent. */
function mockTxRecord(record: Record<string, unknown>): void {
  (
    mockedDb.backgroundCheckRequest.findUnique as unknown as jest.Mock
  ).mockResolvedValueOnce(record);
}

function makeCheckrSignature(rawBody: string): string {
  return createHmac('sha256', 'whsec_test').update(rawBody).digest('hex');
}

function webhookPayload(): {
  id: string;
  type: string;
  data: {
    object: string;
    id: string;
    status?: string;
    adjudication?: string;
    candidate_id?: string;
    updated_at?: string;
    metadata?: {
      compOrganizationId?: string;
      compMemberId?: string;
    };
  };
} {
  return {
    id: 'evt_1',
    type: 'report.completed',
    data: {
      object: 'report',
      id: 'check_1',
      status: 'consider',
      adjudication: 'engaged',
      candidate_id: 'cand_1',
    },
  };
}

describe('BackgroundChecksService webhooks', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset (not just clear): a test that rejects before consuming its
    // queued mockResolvedValueOnce values must not leak them into the next
    // test's reads.
    for (const model of [
      mockedDb.backgroundCheckRequest,
      mockedDb.backgroundCheckWebhookEvent,
    ]) {
      for (const fn of Object.values(model)) {
        (fn as unknown as jest.Mock).mockReset?.();
      }
    }
    // The predicated row write reads `.count`: default to a won race so
    // tests only stage a lost race when they assert the fallback.
    (
      mockedDb.backgroundCheckRequest.updateMany as unknown as jest.Mock
    ).mockResolvedValue({ count: 1 });
    process.env = {
      ...originalEnv,
      CHECKR_WEBHOOK_SECRET: 'whsec_test',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('rejects invalid and stale webhook signatures', async () => {
    const service = new BackgroundChecksService(
      {} as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await expect(
      service.handleWebhook({
        rawBody: Buffer.from('{}'),
        headers: {
          'x-checkr-signature': 'bad',
        },
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await expect(
      service.handleWebhook({
        rawBody: Buffer.from('{}'),
        headers: {},
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('updates status fields and report snapshots from webhook payloads', async () => {
    const payload = webhookPayload();
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      employeeName: 'Ada',
      employeeEmail: 'old@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'old@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });
    const reportSnapshot = {
      identityVerification: { status: 'passed' },
      report: { flags: ['Manual review required'] },
    };
    const identityClient = {
      getReport: jest.fn().mockResolvedValue(reportSnapshot),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // Checkr uses getReport for report fetches
    expect(identityClient.getReport).toHaveBeenCalledWith('check_1');
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed_with_flags',
          reportSnapshot,
          reportSyncedAt: expect.any(Date),
        }),
      }),
    );
    // The request link lands atomically with the apply, inside the
    // transaction — never ahead of the commit.
    expect(
      mockedDb.backgroundCheckWebhookEvent.updateMany,
    ).toHaveBeenCalledWith({
      where: { eventId: 'evt_1', appliedAt: null },
      data: expect.objectContaining({ backgroundCheckRequestId: 'bcr_1' }),
    });
  });

  it('ignores an older out-of-order delivery without moving the row backward', async () => {
    const payload = webhookPayload();
    // This delivery is an hour old; the row already applied a newer event.
    payload.data = {
      ...payload.data,
      updated_at: new Date(Date.now() - 3_600_000).toISOString(),
    };
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      employeeName: 'Ada',
      employeeEmail: 'old@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'old@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
      lastWebhookEventId: 'evt_newer',
    });
    // The last applied event carries a newer vendor timestamp.
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.findUnique>>
    >(mockedDb.backgroundCheckWebhookEvent.findUnique).mockResolvedValueOnce({
      eventId: 'evt_newer',
      payload: {
        data: { updated_at: new Date().toISOString() },
      },
    } as unknown as Awaited<
      ReturnType<typeof db.backgroundCheckWebhookEvent.findUnique>
    >);
    const reportSnapshot = {
      identityVerification: { status: 'passed' },
      report: { flags: ['Manual review required'] },
    };
    const identityClient = {
      getReport: jest.fn().mockResolvedValue(reportSnapshot),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // Seen and decided: acks without duplicate, but the stale event never
    // touches the row and the watermark keeps pointing at the newer event.
    expect(result).toEqual({ ok: true });
    expect(mockedDb.backgroundCheckRequest.updateMany).not.toHaveBeenCalled();
    expect(
      mockedDb.backgroundCheckWebhookEvent.updateMany,
    ).toHaveBeenCalledWith({
      where: { eventId: 'evt_1', appliedAt: null },
      data: expect.objectContaining({ backgroundCheckRequestId: 'bcr_1' }),
    });
  });

  it('applies a newer delivery and advances the event watermark', async () => {
    const payload = webhookPayload();
    payload.data = {
      ...payload.data,
      updated_at: new Date().toISOString(),
    };
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      employeeName: 'Ada',
      employeeEmail: 'old@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'old@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
      lastWebhookEventId: 'evt_older',
    });
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.findUnique>>
    >(mockedDb.backgroundCheckWebhookEvent.findUnique).mockResolvedValueOnce({
      eventId: 'evt_older',
      payload: {
        data: {
          updated_at: new Date(Date.now() - 3_600_000).toISOString(),
        },
      },
    } as unknown as Awaited<
      ReturnType<typeof db.backgroundCheckWebhookEvent.findUnique>
    >);
    const reportSnapshot = {
      identityVerification: { status: 'passed' },
      report: { flags: ['Manual review required'] },
    };
    const identityClient = {
      getReport: jest.fn().mockResolvedValue(reportSnapshot),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed_with_flags',
          lastWebhookEventId: 'evt_1',
        }),
      }),
    );
  });

  it('backs off when the report snapshot fetch fails instead of committing terminal state without one', async () => {
    const payload = webhookPayload();
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      employeeName: 'Ada',
      employeeEmail: 'old@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'old@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });
    const identityClient = {
      getReport: jest.fn().mockRejectedValue(new Error('unavailable')),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await expect(
      service.handleWebhook({
        rawBody: Buffer.from(rawBody),
        headers: {
          'x-checkr-signature': makeCheckrSignature(rawBody),
        },
      }),
    ).rejects.toThrow('not available yet');

    // No status write: the terminal transition waits for the vendor retry.
    // The marker is released so that retry reprocesses instead of acking
    // duplicate on state that was never applied.
    expect(mockedDb.backgroundCheckRequest.updateMany).not.toHaveBeenCalled();
    expect(
      mockedDb.backgroundCheckWebhookEvent.deleteMany,
    ).toHaveBeenCalledWith({
      where: { eventId: 'evt_1', appliedAt: null },
    });
  });

  it('releases the marker when the Checkr key is missing so a later retry reprocesses', async () => {
    const payload = webhookPayload();
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      employeeName: 'Ada',
      employeeEmail: 'old@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'old@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });
    const identityClient = {
      getReport: jest
        .fn()
        .mockRejectedValue(
          new BadRequestException(
            'Background check service is not configured. Contact support.',
          ),
        ),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    // A missing key is operator configuration, not a malformed payload: the
    // error surfaces, but the marker is released so the vendor retry
    // reprocesses once the key exists instead of acking duplicate on state
    // that was never applied.
    await expect(
      service.handleWebhook({
        rawBody: Buffer.from(rawBody),
        headers: {
          'x-checkr-signature': makeCheckrSignature(rawBody),
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockedDb.backgroundCheckRequest.updateMany).not.toHaveBeenCalled();
    expect(
      mockedDb.backgroundCheckWebhookEvent.deleteMany,
    ).toHaveBeenCalledWith({
      where: { eventId: 'evt_1', appliedAt: null },
    });
    expect(
      mockedDb.backgroundCheckWebhookEvent.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('does not fetch report snapshots for non-terminal webhooks', async () => {
    const payload = webhookPayload();
    payload.data.status = 'pending';
    payload.type = 'report.pending';
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      employeeName: 'Ada',
      employeeEmail: 'old@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'old@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });
    const identityClient = {
      getReport: jest.fn(),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    expect(identityClient.getReport).not.toHaveBeenCalled();
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'in_progress' }),
      }),
    );
  });

  it('does not fetch report snapshots for invitation completions on in-flight rows', async () => {
    const rawBody = JSON.stringify({
      id: 'evt_inv',
      type: 'invitation.completed',
      data: {
        object: 'invitation',
        id: 'inv_1',
        status: 'pending',
        candidate_id: 'cand_1',
      },
    });
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'invited',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'inv_1',
      checkrInvitationId: 'inv_1',
    });
    const identityClient = {
      getReport: jest.fn(),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // Invitation completion is not report completion: no snapshot fetch, and
    // no snapshot persisted on the row.
    expect(identityClient.getReport).not.toHaveBeenCalled();
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          reportSnapshot: expect.anything(),
        }),
      }),
    );
  });

  it('rejects deliveries older than the replay window before touching dedup', async () => {
    const payload = webhookPayload();
    (payload.data as { updatedAt?: number }).updatedAt =
      Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
    const rawBody = JSON.stringify(payload);
    const service = new BackgroundChecksService(
      {} as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await expect(
      service.handleWebhook({
        rawBody: Buffer.from(rawBody),
        headers: {
          'x-checkr-signature': makeCheckrSignature(rawBody),
        },
      }),
    ).rejects.toThrow('too old');
    // Rejected before the dedup insert: no event row, no marker to release.
    expect(mockedDb.backgroundCheckWebhookEvent.create).not.toHaveBeenCalled();
    expect(
      mockedDb.backgroundCheckWebhookEvent.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('applies deliveries inside the replay window and without timestamps', async () => {
    const payload = webhookPayload();
    (payload.data as { updatedAt?: number }).updatedAt =
      Math.floor(Date.now() / 1000) - 60;
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });
    const service = new BackgroundChecksService(
      {
        getReport: jest.fn().mockResolvedValue({ status: 'consider' }),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });
    expect(result).toEqual({ ok: true });
  });

  it('does not change status when the local record is already cancelled', async () => {
    const payload = webhookPayload();
    const rawBody = JSON.stringify(payload);
    // The pre-insert snapshot is stale (in-flight) while the transactional
    // re-read sees the terminal row: only the re-read may freeze the write.
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'cancelled',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });
    const service = new BackgroundChecksService(
      {
        getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    expect(mockedDb.backgroundCheckWebhookEvent.create).toHaveBeenCalled();
    expect(mockedDb.backgroundCheckRequest.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('skips the write on duplicate webhook events', async () => {
    const payload = webhookPayload();
    const rawBody = JSON.stringify(payload);
    // No record lookup is mocked: the dedup insert runs before resolution,
    // so a replay never reaches the database lookup at all.
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const identityClient = {
      getReport: jest
        .fn()
        .mockResolvedValue({ status: 'completed_with_flags' }),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    expect(result).toEqual({ ok: true, duplicate: true });
    // A replay must not regress current state
    expect(mockedDb.backgroundCheckRequest.findFirst).not.toHaveBeenCalled();
    expect(mockedDb.backgroundCheckRequest.updateMany).not.toHaveBeenCalled();
  });

  it('freezes terminal records when a stale in-flight event arrives', async () => {
    const payload = webhookPayload();
    payload.data.status = 'pending';
    payload.type = 'report.pending';
    const rawBody = JSON.stringify(payload);
    // Stale pre-insert snapshot (in-flight) vs terminal transactional
    // re-read: dropping the re-read would let this event regress the row
    // to in_progress, so the test fails without the fix.
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'completed',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });
    const service = new BackgroundChecksService(
      {
        getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    expect(mockedDb.backgroundCheckWebhookEvent.create).toHaveBeenCalled();
    expect(mockedDb.backgroundCheckRequest.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('does not overwrite the report pointer or status on status-less invitation events', async () => {
    const payload = webhookPayload();
    payload.type = 'invitation.created';
    payload.data.object = 'invitation';
    payload.data.id = 'inv_1';
    delete payload.data.status;
    delete payload.data.adjudication;
    payload.data.metadata = {
      compOrganizationId: 'org_1',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    const findFirst = mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>
    >(mockedDb.backgroundCheckRequest.findFirst);
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'bcr_1',
      organizationId: 'org_1',
      memberId: 'mem_1',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'invited',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'inv_1',
      checkrInvitationId: 'inv_1',
    });
    const service = new BackgroundChecksService(
      {
        getReport: jest.fn(),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // Resolved via the metadata-scoped candidate fallback, pointer and
    // status left alone
    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: { identityBackgroundCheckId: 'inv_1' },
    });
    expect(findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        checkrCandidateId: 'cand_1',
        organizationId: 'org_1',
        memberId: 'mem_1',
      },
    });
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          checkrCandidateId: 'cand_1',
        }),
      }),
    );
    const updateData = (mockedDb.backgroundCheckRequest.updateMany as jest.Mock)
      .mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('identityBackgroundCheckId');
    expect(updateData).not.toHaveProperty('status');
  });

  it('does not terminalize the row on invitation events with report-like statuses', async () => {
    const payload = webhookPayload();
    payload.type = 'invitation.completed';
    payload.data.object = 'invitation';
    payload.data.id = 'inv_1';
    // Invitation "completed" means the candidate finished the form — the
    // report still has to arrive, so the row must stay in flight.
    payload.data.status = 'completed';
    delete payload.data.adjudication;
    payload.data.metadata = {
      compOrganizationId: 'org_1',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    const findFirst = mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>
    >(mockedDb.backgroundCheckRequest.findFirst);
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'bcr_1',
      organizationId: 'org_1',
      memberId: 'mem_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'inv_1',
      checkrInvitationId: 'inv_1',
    });
    const service = new BackgroundChecksService(
      {
        getReport: jest.fn().mockResolvedValue(null),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ checkrCandidateId: 'cand_1' }),
      }),
    );
    const updateData = (mockedDb.backgroundCheckRequest.updateMany as jest.Mock)
      .mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('status');
    expect(updateData).not.toHaveProperty('identityBackgroundCheckId');
  });

  it('keys dedup on report plus event type and payload when the envelope has no id', async () => {
    const rawBody = JSON.stringify({
      data: { object: 'report', id: 'check_1', status: 'pending' },
    });
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      status: 'invited',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'invited',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });
    const service = new BackgroundChecksService(
      {
        getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // A later report.completed for the same report must not dedup against
    // this report.updated delivery — and neither must a second
    // report.updated carrying a different state.
    const create = mockedDb.backgroundCheckWebhookEvent
      .create as unknown as jest.Mock;
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: expect.stringMatching(
            /^check_1:report\.updated:[0-9a-f]{16}$/,
          ),
          eventType: 'report.updated',
        }),
      }),
    );
    const firstKey = create.mock.calls[0][0].data.eventId as string;

    jest.clearAllMocks();
    const completedBody = JSON.stringify({
      data: { object: 'report', id: 'check_1', status: 'clear' },
    });
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });

    await service.handleWebhook({
      rawBody: Buffer.from(completedBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(completedBody),
      },
    });

    const secondKey = create.mock.calls[0][0].data.eventId as string;
    expect(secondKey).toContain('check_1:report.updated');
    expect(secondKey).not.toBe(firstKey);
  });

  it('scopes the candidate fallback by metadata when Checkr echoes it', async () => {
    const payload = webhookPayload();
    payload.type = 'invitation.created';
    payload.data.object = 'invitation';
    payload.data.id = 'inv_9';
    delete payload.data.status;
    delete payload.data.adjudication;
    payload.data.metadata = {
      compOrganizationId: 'org_1',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    const findFirst = mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>
    >(mockedDb.backgroundCheckRequest.findFirst);
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'bcr_1',
      organizationId: 'org_1',
      memberId: 'mem_1',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'invited',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'inv_9',
      checkrInvitationId: 'inv_9',
    });
    const service = new BackgroundChecksService(
      {
        getReport: jest.fn(),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: { identityBackgroundCheckId: 'inv_9' },
    });
    expect(findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        checkrCandidateId: 'cand_1',
        organizationId: 'org_1',
        memberId: 'mem_1',
      },
    });
  });

  it('rejects webhooks whose metadata points at another tenant', async () => {
    const payload = webhookPayload();
    payload.data.metadata = {
      compOrganizationId: 'org_other',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      organizationId: 'org_1',
      memberId: 'mem_1',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    const service = new BackgroundChecksService(
      {} as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await expect(
      service.handleWebhook({
        rawBody: Buffer.from(rawBody),
        headers: {
          'x-checkr-signature': makeCheckrSignature(rawBody),
        },
      }),
    ).rejects.toThrow('organization mismatch');
    expect(mockedDb.backgroundCheckRequest.updateMany).not.toHaveBeenCalled();
    // Permanent failure keeps the poison marker: no marker release.
    expect(
      mockedDb.backgroundCheckWebhookEvent.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it('accepts webhook metadata that matches the resolved record', async () => {
    const payload = webhookPayload();
    payload.data.metadata = {
      compOrganizationId: 'org_1',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      organizationId: 'org_1',
      memberId: 'mem_1',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      organizationId: 'org_1',
      memberId: 'mem_1',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });
    const identityClient = {
      getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'completed_with_flags' }),
      }),
    );
  });

  it('matches headers regardless of case', async () => {
    const payload = webhookPayload();
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      employeeName: 'Ada',
      employeeEmail: 'old@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'old@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });
    const identityClient = {
      getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'X-Checkr-Signature': makeCheckrSignature(rawBody),
        'X-Checkr-Event-Id': 'evt_cap',
        'X-Checkr-Event-Type': 'report.completed',
      },
    });

    expect(mockedDb.backgroundCheckWebhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventId: 'evt_cap' }),
      }),
    );
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalled();
  });

  it('rejects webhooks with a non-JSON body', async () => {
    const rawBody = 'not-json{{{';
    const service = new BackgroundChecksService(
      {} as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await expect(
      service.handleWebhook({
        rawBody: Buffer.from(rawBody),
        headers: {
          'x-checkr-signature': makeCheckrSignature(rawBody),
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('acks unrecognized Checkr statuses without writing status', async () => {
    // Vendor drift must not wedge the webhook in a retry loop: unknown
    // statuses land on the status-less path and leave the row alone.
    const payload = webhookPayload();
    payload.data.status = 'frobnicated';
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      employeeName: 'Ada',
      employeeEmail: 'old@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'old@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });
    const service = new BackgroundChecksService(
      {
        getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    expect(result).toEqual({ ok: true });
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalled();
    const updateData = (mockedDb.backgroundCheckRequest.updateMany as jest.Mock)
      .mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('status');
  });

  it('releases the marker on unknown rows so a later retry reprocesses', async () => {
    const payload = webhookPayload();
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValue(null);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    const service = new BackgroundChecksService(
      {
        getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    // First delivery: the row is unknown, so the vendor-visible error stands
    // — but the marker is released instead of poisoned, because the row may
    // still land (a webhook that beat the request write).
    await expect(
      service.handleWebhook({
        rawBody: Buffer.from(rawBody),
        headers: {
          'x-checkr-signature': makeCheckrSignature(rawBody),
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      mockedDb.backgroundCheckWebhookEvent.deleteMany,
    ).toHaveBeenCalledWith({ where: { eventId: 'evt_1', appliedAt: null } });

    // The vendor retry reprocesses instead of acking duplicate: the row now
    // exists, so the event applies.
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'invited',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });

    const retry = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });
    expect(retry).toEqual({ ok: true });
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalled();
  });

  it('keeps the poison marker on tenant mismatches so retries ack as duplicate', async () => {
    const payload = webhookPayload();
    payload.data.metadata = {
      compOrganizationId: 'org_other',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      organizationId: 'org_1',
      memberId: 'mem_1',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    const service = new BackgroundChecksService(
      {} as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await expect(
      service.handleWebhook({
        rawBody: Buffer.from(rawBody),
        headers: {
          'x-checkr-signature': makeCheckrSignature(rawBody),
        },
      }),
    ).rejects.toThrow('organization mismatch');
    expect(mockedDb.backgroundCheckRequest.updateMany).not.toHaveBeenCalled();
    // Permanent failure: the marker stays, so the retry acks duplicate.
    expect(
      mockedDb.backgroundCheckWebhookEvent.deleteMany,
    ).not.toHaveBeenCalled();
    // The permanent failure acks the marker on the way out, so the
    // vendor retry acks duplicate instead of reprocessing into another
    // 400 (an unapplied marker would hit the reclaim predicate).
    expect(
      mockedDb.backgroundCheckWebhookEvent.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ appliedAt: null }),
        data: expect.objectContaining({ appliedAt: expect.any(Date) }),
      }),
    );
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.findUnique>>
    >(mockedDb.backgroundCheckWebhookEvent.findUnique).mockResolvedValueOnce({
      eventId: 'evt_1',
      appliedAt: new Date(),
      backgroundCheckRequestId: null,
      processedAt: new Date(Date.now() - 10 * 60 * 1000),
    } as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.findUnique>>);

    const retry = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    expect(retry).toEqual({ ok: true, duplicate: true });
  });

  it('never resolves another tenant through the metadata-less candidate fallback', async () => {
    // A candidate id is shared across organizations for one email. Without
    // metadata there is no safe scoping, so the lookup must not run at all.
    const payload = webhookPayload();
    delete payload.data.metadata;
    const rawBody = JSON.stringify(payload);
    const findFirst = mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>
    >(mockedDb.backgroundCheckRequest.findFirst);
    findFirst.mockResolvedValue(null);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    const service = new BackgroundChecksService(
      {} as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await expect(
      service.handleWebhook({
        rawBody: Buffer.from(rawBody),
        headers: {
          'x-checkr-signature': makeCheckrSignature(rawBody),
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Only the direct lookup runs: no global candidate sweep, no member
    // sweep without a tenant.
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({
      where: { identityBackgroundCheckId: 'check_1' },
    });
  });

  it('graduates an invited row to the first report via the member fallback', async () => {
    const payload = webhookPayload();
    payload.type = 'report.completed';
    payload.data.object = 'report';
    payload.data.id = 'rep_9';
    payload.data.status = 'clear';
    delete payload.data.adjudication;
    delete payload.data.candidate_id;
    payload.data.metadata = {
      compOrganizationId: 'org_1',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    const findFirst = mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>
    >(mockedDb.backgroundCheckRequest.findFirst);
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'bcr_1',
      organizationId: 'org_1',
      memberId: 'mem_1',
      status: 'invited',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'invited',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'inv_1',
      checkrInvitationId: 'inv_1',
    });
    const service = new BackgroundChecksService(
      {
        getReport: jest
          .fn()
          .mockResolvedValue({ id: 'rep_9', status: 'clear' }),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // Indirect resolution against the invitation placeholder graduates the
    // pointer to the real report instead of stalling or 404ing.
    expect(findFirst).toHaveBeenNthCalledWith(2, {
      where: { organizationId: 'org_1', memberId: 'mem_1' },
    });
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          identityBackgroundCheckId: 'rep_9',
          status: 'completed',
        }),
      }),
    );
  });

  it('ignores a stale indirect report event after retry swapped the pointer', async () => {
    const payload = webhookPayload();
    payload.type = 'report.completed';
    payload.data.object = 'report';
    payload.data.id = 'rep_old';
    payload.data.status = 'clear';
    delete payload.data.adjudication;
    payload.data.metadata = {
      compOrganizationId: 'org_1',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'bcr_1',
        organizationId: 'org_1',
        memberId: 'mem_1',
        status: 'in_progress',
        employeeName: 'Ada',
        employeeEmail: 'ada@example.com',
        identityBackgroundCheckId: 'rep_new',
        checkrInvitationId: 'inv_1',
        supersededIdentityBackgroundCheckIds: ['rep_old'],
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    // No transactional re-read is queued: the stale path acks before the
    // transaction, and an unconsumed mock would leak into later tests.
    const identityClient = {
      getReport: jest.fn(),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // The row already points at the retry's fresh report: the late event
    // for the superseded report acks without touching pointer or status.
    expect(result).toEqual({ ok: true });
    expect(identityClient.getReport).not.toHaveBeenCalled();
    expect(mockedDb.backgroundCheckRequest.updateMany).not.toHaveBeenCalled();
  });

  it('does not rewind the pointer when a retry swaps it mid-delivery', async () => {
    const payload = webhookPayload();
    payload.type = 'report.completed';
    payload.data.object = 'report';
    payload.data.id = 'rep_old';
    payload.data.status = 'clear';
    delete payload.data.adjudication;
    payload.data.metadata = {
      compOrganizationId: 'org_1',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    // Resolved direct: at resolve time the row still points at rep_old.
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      organizationId: 'org_1',
      memberId: 'mem_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'rep_old',
      checkrInvitationId: 'inv_1',
      supersededIdentityBackgroundCheckIds: [] as string[],
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    // A retry swaps the pointer to rep_new while this delivery waits
    // (e.g. during the pre-transaction snapshot fetch): the in-transaction
    // re-read sees the swapped row.
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'rep_new',
      checkrInvitationId: 'inv_1',
      supersededIdentityBackgroundCheckIds: ['rep_old'],
    });
    const identityClient = {
      getReport: jest
        .fn()
        .mockResolvedValue({ id: 'rep_old', status: 'clear' }),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // The pre-transaction `direct` resolution must not skip the stale guard
    // on the swapped pointer: the delivery acks without rewinding it.
    expect(result).toEqual({ ok: true });
    expect(mockedDb.backgroundCheckRequest.updateMany).not.toHaveBeenCalled();
    expect(
      mockedDb.backgroundCheckWebhookEvent.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ appliedAt: expect.any(Date) }),
      }),
    );
  });

  it('ignores an expiry event for a superseded invitation after retry', async () => {
    const payload = webhookPayload();
    payload.id = 'evt_2';
    payload.type = 'invitation.expired';
    payload.data.object = 'invitation';
    payload.data.id = 'inv_old';
    payload.data.status = 'expired';
    delete payload.data.adjudication;
    delete payload.data.candidate_id;
    payload.data.metadata = {
      compOrganizationId: 'org_1',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    const retriedRow = {
      id: 'bcr_1',
      organizationId: 'org_1',
      memberId: 'mem_1',
      status: 'invited',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'inv_new',
      checkrInvitationId: 'inv_new',
      supersededIdentityBackgroundCheckIds: ['inv_old'],
    };
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    )
      // No direct hit: the row moved on to the retry's fresh invitation.
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        retriedRow as Awaited<
          ReturnType<typeof db.backgroundCheckRequest.findFirst>
        >,
      );
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({ ...retriedRow });
    const identityClient = {
      getReport: jest.fn(),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // The expired invitation belongs to the superseded attempt: the fresh
    // attempt stays invited instead of being marked failed.
    expect(result).toEqual({ ok: true });
    expect(identityClient.getReport).not.toHaveBeenCalled();
    expect(mockedDb.backgroundCheckRequest.updateMany).not.toHaveBeenCalled();
    expect(
      mockedDb.backgroundCheckWebhookEvent.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ appliedAt: expect.any(Date) }),
      }),
    );
  });

  it('stays stale after retry even when the fresh pointer is an invitation id', async () => {
    const payload = webhookPayload();
    payload.type = 'report.completed';
    payload.data.object = 'report';
    payload.data.id = 'rep_old';
    payload.data.status = 'clear';
    delete payload.data.adjudication;
    payload.data.metadata = {
      compOrganizationId: 'org_1',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'bcr_1',
        organizationId: 'org_1',
        memberId: 'mem_1',
        status: 'in_progress',
        employeeName: 'Ada',
        employeeEmail: 'ada@example.com',
        identityBackgroundCheckId: 'inv_new',
        checkrInvitationId: 'inv_new',
        supersededIdentityBackgroundCheckIds: ['rep_old'],
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    // No transactional re-read is queued: the stale path acks before the
    // transaction, and an unconsumed mock would leak into later tests.
    const identityClient = {
      getReport: jest.fn(),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // The retry swapped in a fresh invitation pointer: the late event for
    // the superseded report acks without rewinding the pointer.
    expect(result).toEqual({ ok: true });
    expect(identityClient.getReport).not.toHaveBeenCalled();
    expect(mockedDb.backgroundCheckRequest.updateMany).not.toHaveBeenCalled();
  });

  it('applies the new report for a retried row with an ungraduated pointer', async () => {
    const payload = webhookPayload();
    payload.type = 'report.completed';
    payload.data.object = 'report';
    payload.data.id = 'rep_new';
    payload.data.status = 'clear';
    delete payload.data.adjudication;
    delete payload.data.candidate_id;
    payload.data.metadata = {
      compOrganizationId: 'org_1',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'bcr_1',
        organizationId: 'org_1',
        memberId: 'mem_1',
        status: 'in_progress',
        employeeName: 'Ada',
        employeeEmail: 'ada@example.com',
        identityBackgroundCheckId: 'inv_new',
        checkrInvitationId: 'inv_new',
        supersededIdentityBackgroundCheckIds: ['rep_old'],
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'inv_new',
      checkrInvitationId: 'inv_new',
    });
    const identityClient = {
      getReport: jest
        .fn()
        .mockResolvedValue({ id: 'rep_new', status: 'clear' }),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // The event names no superseded report, so it is the new report
    // arriving: the pointer graduates instead of stalling on the retry's
    // invitation placeholder.
    expect(result).toEqual({ ok: true });
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          identityBackgroundCheckId: 'rep_new',
          status: 'completed',
        }),
      }),
    );
  });

  it('ignores a late report from the prior attempt on a retried invitation row', async () => {
    // The retry swapped in a fresh invitation while the prior attempt was
    // still an invitation placeholder, so the superseded list holds an
    // invitation id that no report id can ever equal. The late report from
    // the prior flow is indistinguishable locally — but the current
    // invitation already names a different report, so the event is foreign.
    const payload = webhookPayload();
    payload.type = 'report.completed';
    payload.data.object = 'report';
    payload.data.id = 'rep_old';
    payload.data.status = 'clear';
    delete payload.data.adjudication;
    delete payload.data.candidate_id;
    payload.data.metadata = {
      compOrganizationId: 'org_1',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'bcr_1',
        organizationId: 'org_1',
        memberId: 'mem_1',
        status: 'in_progress',
        employeeName: 'Ada',
        employeeEmail: 'ada@example.com',
        identityBackgroundCheckId: 'inv_new',
        checkrInvitationId: 'inv_new',
        supersededIdentityBackgroundCheckIds: ['inv_old'],
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    // No transactional re-read is queued: the foreign path acks before the
    // transaction, and an unconsumed mock would leak into later tests.
    const identityClient = {
      getReport: jest.fn(),
      getInvitation: jest
        .fn()
        .mockResolvedValue({ id: 'inv_new', report: { id: 'rep_new' } }),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // The old check's result must not graduate the new attempt: the event
    // acks as deliberately ignored and the pointer is untouched.
    expect(result).toEqual({ ok: true });
    expect(identityClient.getInvitation).toHaveBeenCalledWith('inv_new');
    expect(identityClient.getReport).not.toHaveBeenCalled();
    expect(mockedDb.backgroundCheckRequest.updateMany).not.toHaveBeenCalled();
    expect(
      mockedDb.backgroundCheckWebhookEvent.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ appliedAt: expect.any(Date) }),
      }),
    );
  });

  it('ignores an unmatched report while the current invitation has no report yet', async () => {
    // The current invitation flow has not completed, so no report event
    // can be its report — the event belongs to a prior attempt.
    const payload = webhookPayload();
    payload.type = 'report.completed';
    payload.data.object = 'report';
    payload.data.id = 'rep_old';
    payload.data.status = 'clear';
    delete payload.data.adjudication;
    delete payload.data.candidate_id;
    payload.data.metadata = {
      compOrganizationId: 'org_1',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'bcr_1',
        organizationId: 'org_1',
        memberId: 'mem_1',
        status: 'in_progress',
        employeeName: 'Ada',
        employeeEmail: 'ada@example.com',
        identityBackgroundCheckId: 'inv_new',
        checkrInvitationId: 'inv_new',
        supersededIdentityBackgroundCheckIds: ['inv_old'],
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    const identityClient = {
      getReport: jest.fn(),
      getInvitation: jest
        .fn()
        .mockResolvedValue({ id: 'inv_new', status: 'pending' }),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    expect(result).toEqual({ ok: true });
    expect(mockedDb.backgroundCheckRequest.updateMany).not.toHaveBeenCalled();
    expect(
      mockedDb.backgroundCheckWebhookEvent.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ appliedAt: expect.any(Date) }),
      }),
    );
  });

  it('applies the report the current invitation names on a retried row', async () => {
    // The ambiguous event survives verification: the current invitation
    // already names this report, so it is the new attempt arriving — not
    // the prior attempt arriving late.
    const payload = webhookPayload();
    payload.type = 'report.completed';
    payload.data.object = 'report';
    payload.data.id = 'rep_new';
    payload.data.status = 'clear';
    delete payload.data.adjudication;
    delete payload.data.candidate_id;
    payload.data.metadata = {
      compOrganizationId: 'org_1',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'bcr_1',
        organizationId: 'org_1',
        memberId: 'mem_1',
        status: 'in_progress',
        employeeName: 'Ada',
        employeeEmail: 'ada@example.com',
        identityBackgroundCheckId: 'inv_new',
        checkrInvitationId: 'inv_new',
        supersededIdentityBackgroundCheckIds: ['inv_old'],
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'inv_new',
      checkrInvitationId: 'inv_new',
    });
    const identityClient = {
      getReport: jest
        .fn()
        .mockResolvedValue({ id: 'rep_new', status: 'clear' }),
      getInvitation: jest
        .fn()
        .mockResolvedValue({ id: 'inv_new', report_id: 'rep_new' }),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    expect(result).toEqual({ ok: true });
    expect(identityClient.getInvitation).toHaveBeenCalledWith('inv_new');
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          identityBackgroundCheckId: 'rep_new',
          status: 'completed',
        }),
      }),
    );
  });

  it('backs off when the current invitation cannot be read for verification', async () => {
    // Uncertainty must never ack: the marker is released so the vendor
    // retry reprocesses once Checkr is readable again.
    const payload = webhookPayload();
    payload.type = 'report.completed';
    payload.data.object = 'report';
    payload.data.id = 'rep_old';
    payload.data.status = 'clear';
    delete payload.data.adjudication;
    delete payload.data.candidate_id;
    payload.data.metadata = {
      compOrganizationId: 'org_1',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'bcr_1',
        organizationId: 'org_1',
        memberId: 'mem_1',
        status: 'in_progress',
        employeeName: 'Ada',
        employeeEmail: 'ada@example.com',
        identityBackgroundCheckId: 'inv_new',
        checkrInvitationId: 'inv_new',
        supersededIdentityBackgroundCheckIds: ['inv_old'],
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    const identityClient = {
      getReport: jest.fn(),
      getInvitation: jest.fn().mockResolvedValue(null),
    };
    const service = new BackgroundChecksService(
      identityClient as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await expect(
      service.handleWebhook({
        rawBody: Buffer.from(rawBody),
        headers: {
          'x-checkr-signature': makeCheckrSignature(rawBody),
        },
      }),
    ).rejects.toThrow('not readable');
    // Released, not acked: no appliedAt write, marker deleted for retry.
    expect(mockedDb.backgroundCheckWebhookEvent.deleteMany).toHaveBeenCalled();
    expect(
      mockedDb.backgroundCheckWebhookEvent.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('marks an invited row failed when its invitation expires', async () => {
    const payload = webhookPayload();
    payload.type = 'invitation.expired';
    payload.data.object = 'invitation';
    payload.data.id = 'inv_1';
    payload.data.status = 'expired';
    delete payload.data.adjudication;
    delete payload.data.candidate_id;
    payload.data.metadata = {
      compOrganizationId: 'org_1',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      organizationId: 'org_1',
      memberId: 'mem_1',
      status: 'invited',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'inv_1',
      checkrInvitationId: 'inv_1',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'invited',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'inv_1',
      checkrInvitationId: 'inv_1',
    });
    const service = new BackgroundChecksService(
      {
        getReport: jest.fn().mockResolvedValue(null),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // An expired invitation can never produce a report: the invited row
    // advances to failed so it can be retried instead of deadlocked.
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('rejects webhooks with an invalid payload shape', async () => {
    const rawBody = JSON.stringify({ nonsense: true });
    const service = new BackgroundChecksService(
      {} as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await expect(
      service.handleWebhook({
        rawBody: Buffer.from(rawBody),
        headers: {
          'x-checkr-signature': makeCheckrSignature(rawBody),
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects webhooks with no raw body', async () => {
    const service = new BackgroundChecksService(
      {} as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await expect(
      service.handleWebhook({ rawBody: undefined, headers: {} }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reprocesses a delivery whose marker was abandoned by a crashed worker', async () => {
    const payload = webhookPayload();
    const rawBody = JSON.stringify(payload);
    // The unique conflict fires, but the existing marker never applied and
    // predates the stale window: the worker died between insert and commit.
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    mockAsync(
      mockedDb.backgroundCheckWebhookEvent.findUnique,
    ).mockResolvedValueOnce({
      eventId: 'evt_1',
      appliedAt: null,
      backgroundCheckRequestId: null,
      processedAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    mockAsync(
      mockedDb.backgroundCheckWebhookEvent.deleteMany,
    ).mockResolvedValueOnce({ count: 1 });
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });
    const service = new BackgroundChecksService(
      {
        getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // Reprocessed, not acked: the state transition actually ran.
    expect(result).toEqual({ ok: true });
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalled();
    // The reclaim re-inserts the marker under this delivery, so future
    // replays ack duplicate instead of reprocessing forever.
    expect(mockedDb.backgroundCheckWebhookEvent.create).toHaveBeenCalledTimes(
      2,
    );
    expect(
      mockedDb.backgroundCheckWebhookEvent.create,
    ).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        eventId: 'evt_1',
        eventType: 'report.completed',
      }),
    });
  });

  it('acks duplicate when a concurrent delivery wins the reclaim re-create', async () => {
    const payload = webhookPayload();
    const rawBody = JSON.stringify(payload);
    const create = mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create);
    // Initial claim conflicts, and the re-create after the reclaim delete
    // conflicts too: a concurrent delivery re-created first and is
    // processing the event.
    create
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      )
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
    mockAsync(
      mockedDb.backgroundCheckWebhookEvent.findUnique,
    ).mockResolvedValueOnce({
      eventId: 'evt_1',
      appliedAt: null,
      backgroundCheckRequestId: null,
      processedAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    mockAsync(
      mockedDb.backgroundCheckWebhookEvent.deleteMany,
    ).mockResolvedValueOnce({ count: 1 });
    const service = new BackgroundChecksService(
      {} as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    expect(result).toEqual({ ok: true, duplicate: true });
    expect(mockedDb.backgroundCheckRequest.findFirst).not.toHaveBeenCalled();
  });

  it('records link plus applied when ignoring a stale indirect event', async () => {
    const payload = webhookPayload();
    // A late event for a superseded report: the row already graduated to a
    // newer report, so this delivery resolves indirectly and must not
    // rewind the pointer.
    payload.data.metadata = {
      compOrganizationId: 'org_1',
      compMemberId: 'mem_1',
    };
    const rawBody = JSON.stringify(payload);
    const findFirst = mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>
    >(mockedDb.backgroundCheckRequest.findFirst);
    findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'bcr_1',
        organizationId: 'org_1',
        memberId: 'mem_1',
        status: 'in_progress',
        employeeName: 'Ada',
        employeeEmail: 'ada@example.com',
        identityBackgroundCheckId: 'rep_new',
        checkrInvitationId: 'inv_9',
        rerunCount: 1,
      } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    const service = new BackgroundChecksService(
      {
        getReport: jest.fn(),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // Seen and deliberately ignored: no row write, but the decision is
    // recorded so a redelivery acks duplicate instead of reprocessing.
    expect(result).toEqual({ ok: true });
    expect(mockedDb.backgroundCheckRequest.updateMany).not.toHaveBeenCalled();
    expect(
      mockedDb.backgroundCheckWebhookEvent.updateMany,
    ).toHaveBeenCalledWith({
      where: { eventId: 'evt_1', appliedAt: null },
      data: {
        backgroundCheckRequestId: 'bcr_1',
        appliedAt: expect.any(Date),
      },
    });
  });

  it('acks a duplicate whose marker belongs to a worker still in flight', async () => {
    const payload = webhookPayload();
    const rawBody = JSON.stringify(payload);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    mockAsync(
      mockedDb.backgroundCheckWebhookEvent.findUnique,
    ).mockResolvedValueOnce({
      eventId: 'evt_1',
      appliedAt: null,
      backgroundCheckRequestId: null,
      processedAt: new Date(),
    });
    const service = new BackgroundChecksService(
      {} as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    expect(result).toEqual({ ok: true, duplicate: true });
    expect(mockedDb.backgroundCheckRequest.findFirst).not.toHaveBeenCalled();
  });

  it('rejects future-dated deliveries that would otherwise stay fresh forever', async () => {
    const payload = webhookPayload();
    (payload.data as { updatedAt?: number }).updatedAt =
      Math.floor(Date.now() / 1000) + 60 * 60;
    const rawBody = JSON.stringify(payload);
    const service = new BackgroundChecksService(
      {} as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await expect(
      service.handleWebhook({
        rawBody: Buffer.from(rawBody),
        headers: {
          'x-checkr-signature': makeCheckrSignature(rawBody),
        },
      }),
    ).rejects.toThrow('too old');
    expect(mockedDb.backgroundCheckWebhookEvent.create).not.toHaveBeenCalled();
  });

  it('reads snake_case ISO timestamps from real Checkr payloads', async () => {
    const rawBody = JSON.stringify({
      id: 'evt_1',
      type: 'report.completed',
      data: {
        object: 'report',
        id: 'check_1',
        status: 'clear',
        updated_at: new Date(Date.now() - 60 * 1000).toISOString(),
      },
    });
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });
    const service = new BackgroundChecksService(
      {
        getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });
    expect(result).toEqual({ ok: true });

    // And an 8-day-old snake_case timestamp is rejected, not applied.
    const staleBody = JSON.stringify({
      id: 'evt_2',
      type: 'report.completed',
      data: {
        object: 'report',
        id: 'check_1',
        status: 'clear',
        updated_at: new Date(
          Date.now() - 8 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
    });
    await expect(
      service.handleWebhook({
        rawBody: Buffer.from(staleBody),
        headers: {
          'x-checkr-signature': makeCheckrSignature(staleBody),
        },
      }),
    ).rejects.toThrow('too old');
  });

  it('applies the status when the vendor email is malformed and keeps the stored address', async () => {
    const payload = webhookPayload();
    (payload.data as { candidateEmail?: string }).candidateEmail =
      'not-an-email';
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });
    const service = new BackgroundChecksService(
      {
        getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // The transition applies (no 400 wedge); the garbage address is ignored.
    expect(result).toEqual({ ok: true });
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed_with_flags',
          employeeEmail: 'ada@example.com',
        }),
      }),
    );
  });

  it('freezes instead of clobbering when the row terminalizes mid-delivery', async () => {
    const payload = webhookPayload();
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    // The re-read sees an in-flight row, but a concurrent writer
    // terminalizes it before the predicated write lands.
    mockTxRecord({
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });
    mockTxRecord({
      id: 'bcr_1',
      status: 'completed',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    });
    (
      mockedDb.backgroundCheckRequest.updateMany as unknown as jest.Mock
    ).mockResolvedValueOnce({ count: 0 });
    const service = new BackgroundChecksService(
      {
        getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // One predicated attempt, then the freeze: the stale in-flight
    // transition never overwrites the terminal row, and the marker still
    // records the decision so a redelivery acks duplicate.
    expect(result).toEqual({ ok: true });
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledTimes(1);
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'bcr_1',
          status: 'in_progress',
        }),
      }),
    );
    expect(
      mockedDb.backgroundCheckWebhookEvent.updateMany,
    ).toHaveBeenCalledWith({
      where: { eventId: 'evt_1', appliedAt: null },
      data: {
        backgroundCheckRequestId: 'bcr_1',
        appliedAt: expect.any(Date),
      },
    });
  });

  it('re-decides on fresh state when a concurrent delivery wins the write', async () => {
    const payload = webhookPayload();
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    const inFlight = {
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    };
    mockTxRecord(inFlight);
    mockTxRecord({ ...inFlight, employeeName: 'Ada Updated' });
    (
      mockedDb.backgroundCheckRequest.updateMany as unknown as jest.Mock
    ).mockResolvedValueOnce({ count: 0 });
    const service = new BackgroundChecksService(
      {
        getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    const result = await service.handleWebhook({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-checkr-signature': makeCheckrSignature(rawBody),
      },
    });

    // The second attempt re-decides on the fresh row instead of dropping
    // the transition or clobbering the winner with stale state.
    expect(result).toEqual({ ok: true });
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenCalledTimes(2);
    expect(mockedDb.backgroundCheckRequest.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          employeeName: 'Ada Updated',
          status: 'completed_with_flags',
        }),
      }),
    );
  });

  it('fails transiently when the row churns under concurrent writers', async () => {
    const payload = webhookPayload();
    const rawBody = JSON.stringify(payload);
    mockAsync<Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>>(
      mockedDb.backgroundCheckRequest.findFirst,
    ).mockResolvedValueOnce({
      id: 'bcr_1',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
    } as Awaited<ReturnType<typeof db.backgroundCheckRequest.findFirst>>);
    mockAsync<
      Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>
    >(mockedDb.backgroundCheckWebhookEvent.create).mockResolvedValueOnce(
      {} as Awaited<ReturnType<typeof db.backgroundCheckWebhookEvent.create>>,
    );
    const inFlight = {
      id: 'bcr_1',
      status: 'in_progress',
      employeeName: 'Ada',
      employeeEmail: 'ada@example.com',
      identityBackgroundCheckId: 'check_1',
      checkrInvitationId: null,
    };
    mockTxRecord(inFlight);
    mockTxRecord(inFlight);
    mockTxRecord(inFlight);
    (mockedDb.backgroundCheckRequest.updateMany as unknown as jest.Mock)
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    const service = new BackgroundChecksService(
      {
        getReport: jest.fn().mockResolvedValue({ status: 'clear' }),
      } as unknown as CheckrClient,
      {} as unknown as BackgroundCheckPaymentService,
    );

    await expect(
      service.handleWebhook({
        rawBody: Buffer.from(rawBody),
        headers: {
          'x-checkr-signature': makeCheckrSignature(rawBody),
        },
      }),
    ).rejects.toThrow('changed while applying');

    // Transient failure: the marker is released so the vendor retry
    // reprocesses instead of acking duplicate on unwritten state.
    expect(
      mockedDb.backgroundCheckWebhookEvent.deleteMany,
    ).toHaveBeenCalledWith({ where: { eventId: 'evt_1', appliedAt: null } });
  });
});
