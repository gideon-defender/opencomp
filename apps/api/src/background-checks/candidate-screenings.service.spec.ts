import { db } from '@db';
import { CandidateScreeningsService } from './candidate-screenings.service';
import { CheckrIntakeConfigService } from './checkr-intake-config.service';
import { StartCandidateScreeningDto } from './dto/start-candidate-screening.dto';

jest.mock('@db', () => ({
  db: {
    candidateScreening: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  },
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
}));

describe('Candidate screening intake', () => {
  const config = { client: jest.fn() };
  const input: StartCandidateScreeningDto = {
    operationId: 'd99e647c-a4ac-4ff1-b5b5-ddd96f7f423a',
    email: 'a@b.com',
    firstName: 'A',
    lastName: 'B',
    country: 'US',
    state: 'CA',
  };
  const service = new CandidateScreeningsService(
    config as unknown as CheckrIntakeConfigService,
  );
  const candidate = { upsert: jest.fn() };
  const screening = { create: jest.fn() };
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(db.candidateScreening.findUnique).mockResolvedValue(null);
    config.client.mockResolvedValue({
      connection: { id: 'conn_a', package: 'basic', node: null },
    });
    candidate.upsert.mockResolvedValue({ id: 'candidate_a' });
    screening.create.mockResolvedValue({ id: 'screening_a', status: 'queued' });
    jest
      .mocked(db.$transaction)
      .mockImplementation(async (callback: unknown) => {
        if (typeof callback !== 'function')
          throw new Error('Expected transaction callback');
        return callback({
          peopleCandidate: candidate,
          candidateScreening: screening,
        });
      });
  });

  it('writes candidate/outbox records only, with tenant ownership and no access fields', async () => {
    await expect(
      service.start({ organizationId: 'tenant_a', input }),
    ).resolves.toEqual({ runId: 'screening_a', status: 'queued' });
    expect(candidate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_email: {
            organizationId: 'tenant_a',
            email: 'a@b.com',
          },
        },
      }),
    );
    expect(screening.create).toHaveBeenCalledWith({
      data: {
        ...input,
        organizationId: 'tenant_a',
        candidateId: 'candidate_a',
        connectionId: 'conn_a',
        package: 'basic',
        node: null,
      },
    });
  });

  it('rejects misconfigured intake before creating candidate records', async () => {
    config.client.mockRejectedValue(new Error('Tenant credentials missing'));
    await expect(
      service.start({ organizationId: 'tenant_b', input }),
    ).rejects.toThrow('credentials missing');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('lists only the authenticated tenant’s attempts', async () => {
    jest.mocked(db.candidateScreening.findMany).mockResolvedValue([]);
    jest.mocked(db.candidateScreening.count).mockResolvedValue(0);
    await service.list('tenant_b');
    expect(db.candidateScreening.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'tenant_b' } }),
    );
  });

  it('deduplicates the same operation without another candidate or dispatch record', async () => {
    jest.mocked(db.candidateScreening.findUnique).mockResolvedValue({
      ...input,
      id: 'screening_a',
      organizationId: 'tenant_a',
      candidateId: 'candidate_a',
      connectionId: 'conn_a',
      state: 'CA',
      city: null,
      package: 'basic',
      node: null,
      status: 'queued',
      candidateKey: 'ckey',
      invitationKey: 'ikey',
      checkrCandidateId: null,
      checkrInvitationId: null,
      chargedAt: null,
      dispatchedAt: null,
      firstDispatchAt: null,
      attempts: 0,
      leaseToken: null,
      leaseUntil: null,
      nextAttemptAt: new Date(),
      errorCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(
      service.start({ organizationId: 'tenant_a', input }),
    ).resolves.toEqual({ runId: 'screening_a', status: 'queued' });
    expect(config.client).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    await expect(
      service.start({
        organizationId: 'tenant_a',
        input: { ...input, email: 'other@b.com' },
      }),
    ).rejects.toThrow('different screening details');
  });

  it('never returns a different tenant’s screening by ID', async () => {
    jest.mocked(db.candidateScreening.findFirst).mockResolvedValue(null);
    await expect(
      service.get({ organizationId: 'tenant_b', id: 'screening_a' }),
    ).rejects.toThrow('not found');
    expect(db.candidateScreening.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'tenant_b', id: 'screening_a' },
      }),
    );
  });
});
