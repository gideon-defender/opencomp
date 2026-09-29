import { db } from '@db';
import {
  parseIdentityCheckState,
  runReconciliation,
} from './reconcile-background-checks-schedule';

// Mock @db at the module boundary so importing the task does not connect to
// Postgres.
jest.mock('@db', () => ({
  db: {
    backgroundCheckRequest: { findMany: jest.fn(), updateMany: jest.fn() },
  },
  BackgroundCheckStatus: {
    invited: 'invited',
    in_progress: 'in_progress',
    in_review: 'in_review',
    completed: 'completed',
    completed_with_flags: 'completed_with_flags',
    failed: 'failed',
    cancelled: 'cancelled',
  },
  Prisma: {},
}));

jest.mock('@gideon-defender/trigger-local', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  schedules: { task: (config: unknown) => config },
}));

const mockGetReport = jest.fn();
const mockGetInvitation = jest.fn();
const mockResolveReport = jest.fn();
jest.mock('../../background-checks/checkr.client', () => ({
  CheckrClient: jest.fn().mockImplementation(() => ({
    getReport: mockGetReport,
    getInvitation: mockGetInvitation,
    resolveReport: mockResolveReport,
  })),
}));

const mockFetchSnapshot = jest.fn();
jest.mock('../../background-checks/background-check-report-snapshot', () => ({
  fetchCompletedReportSnapshot: (...args: unknown[]) =>
    mockFetchSnapshot(...args),
}));

const mockedDb = db as jest.Mocked<typeof db>;
const findMany = mockedDb.backgroundCheckRequest.findMany as jest.Mock;
const updateMany = mockedDb.backgroundCheckRequest.updateMany as jest.Mock;

const NON_TERMINAL = ['invited', 'in_progress', 'in_review'];

describe('parseIdentityCheckState', () => {
  it('extracts status and sub-statuses from a well-formed response', () => {
    const result = parseIdentityCheckState({
      status: 'completed',
      statuses: { identity: 'passed', employment: 'verified' },
    });
    expect(result.status).toBe('completed');
    expect(result.statuses).toEqual({
      identity: 'passed',
      employment: 'verified',
    });
  });

  it('returns no status when the field is absent', () => {
    expect(parseIdentityCheckState({ id: 'check_1' }).status).toBeUndefined();
  });

  it('returns no status when the value is not a known status', () => {
    expect(
      parseIdentityCheckState({ status: 'totally_made_up' }).status,
    ).toBeUndefined();
  });

  it('keeps a valid status even when the statuses object is malformed', () => {
    const garbage = parseIdentityCheckState({
      status: 'completed',
      statuses: 'not-an-object',
    });
    expect(garbage.status).toBe('completed');
    expect(garbage.statuses).toBeUndefined();

    const badField = parseIdentityCheckState({
      status: 'in_review',
      statuses: { identity: 123 },
    });
    expect(badField.status).toBe('in_review');
    expect(badField.statuses).toBeUndefined();
  });

  it('returns nothing for non-object input', () => {
    expect(parseIdentityCheckState(null).status).toBeUndefined();
    expect(parseIdentityCheckState('nope').status).toBeUndefined();
  });
});

describe('runReconciliation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, CHECKR_API_KEY: 'bc_test' };
    mockFetchSnapshot.mockResolvedValue(null);
    updateMany.mockResolvedValue({ count: 1 });
    // Default to the plain read path so existing tests keep their shape;
    // tests for the preferred path override resolveReport per case.
    mockResolveReport.mockImplementation(
      async ({
        reportId,
      }: {
        reportId: string;
        invitationId?: string | null;
      }) => ({ report: await mockGetReport(reportId), reportId }),
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('skips entirely when the API key is not configured', async () => {
    delete process.env.CHECKR_API_KEY;
    const result = await runReconciliation();
    expect(findMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      checked: 0,
      updated: 0,
      unparseable: 0,
    });
  });

  it('applies a newly-reported status (and report snapshot) guarded on non-terminal state', async () => {
    findMany.mockResolvedValue([
      {
        id: 'bcr_1',
        identityBackgroundCheckId: 'check_1',
        status: 'in_progress',
      },
    ]);
    mockGetReport.mockResolvedValue({
      status: 'completed',
      statuses: { identity: 'passed', employment: 'verified' },
    });
    mockFetchSnapshot.mockResolvedValue({ report: 'x' });

    const result = await runReconciliation();

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'bcr_1',
        status: { in: NON_TERMINAL },
        identityBackgroundCheckId: 'check_1',
      },
      data: expect.objectContaining({
        status: 'completed',
        identityStatus: 'passed',
        employmentStatus: 'verified',
        reportSnapshot: { report: 'x' },
        reportSyncedAt: expect.any(Date),
      }),
    });
    expect(result.updated).toBe(1);
  });

  it('refreshes a changed sub-status even when the top-level status is unchanged', async () => {
    findMany.mockResolvedValue([
      {
        id: 'bcr_1',
        identityBackgroundCheckId: 'check_1',
        status: 'in_progress',
        identityStatus: 'pending',
      },
    ]);
    mockGetReport.mockResolvedValue({
      status: 'in_progress',
      statuses: { identity: 'passed' },
    });

    const result = await runReconciliation();

    const call = updateMany.mock.calls[0][0];
    expect(call.data).toMatchObject({ identityStatus: 'passed' });
    expect(call.data).not.toHaveProperty('status');
    expect(result.updated).toBe(1);
  });

  it('only bumps lastSyncedAt when nothing changed', async () => {
    findMany.mockResolvedValue([
      {
        id: 'bcr_1',
        identityBackgroundCheckId: 'check_1',
        status: 'in_progress',
      },
    ]);
    mockGetReport.mockResolvedValue({ status: 'in_progress' });

    const result = await runReconciliation();

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'bcr_1',
        status: { in: NON_TERMINAL },
        identityBackgroundCheckId: 'check_1',
      },
      data: { lastSyncedAt: expect.any(Date) },
    });
    expect(result.updated).toBe(0);
  });

  it('bumps lastSyncedAt for checks whose status cannot be determined', async () => {
    findMany.mockResolvedValue([
      {
        id: 'bcr_1',
        identityBackgroundCheckId: 'check_1',
        status: 'in_progress',
      },
    ]);
    mockGetReport.mockResolvedValue({ status: 'totally_made_up' });

    const result = await runReconciliation();

    // lastSyncedAt advances so the row backs off instead of re-polling hourly
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'bcr_1', status: { in: NON_TERMINAL } },
      data: { lastSyncedAt: expect.any(Date) },
    });
    expect(result).toEqual({
      success: true,
      checked: 1,
      updated: 0,
      unparseable: 1,
    });
  });

  it('backs off a non-string vendor status instead of aborting the batch', async () => {
    findMany.mockResolvedValue([
      {
        id: 'bcr_bad',
        identityBackgroundCheckId: 'check_bad',
        status: 'in_progress',
      },
      {
        id: 'bcr_good',
        identityBackgroundCheckId: 'rep_1',
        status: 'in_progress',
      },
    ]);
    mockGetReport
      .mockResolvedValueOnce({ status: 42 })
      .mockResolvedValueOnce({ status: 'clear' });

    const result = await runReconciliation();

    // The malformed payload backs off as unparseable while the rest of the
    // batch still processes.
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'bcr_bad', status: { in: NON_TERMINAL } },
      data: { lastSyncedAt: expect.any(Date) },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'bcr_good',
        status: { in: NON_TERMINAL },
        identityBackgroundCheckId: 'rep_1',
      },
      data: expect.objectContaining({ status: 'completed' }),
    });
    expect(result).toEqual({
      success: true,
      checked: 2,
      updated: 1,
      unparseable: 1,
    });
  });

  it('maps raw Checkr statuses via the Checkr fallback', async () => {
    findMany.mockResolvedValue([
      {
        id: 'bcr_1',
        identityBackgroundCheckId: 'rep_1',
        status: 'in_progress',
      },
    ]);
    mockGetReport.mockResolvedValue({ status: 'clear' });

    const result = await runReconciliation();

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'bcr_1',
        status: { in: NON_TERMINAL },
        identityBackgroundCheckId: 'rep_1',
      },
      data: expect.objectContaining({ status: 'completed' }),
    });
    expect(result.updated).toBe(1);
  });

  it('bumps lastSyncedAt when the Checkr report is gone', async () => {
    findMany.mockResolvedValue([
      {
        id: 'bcr_1',
        identityBackgroundCheckId: 'rep_deleted',
        status: 'in_progress',
      },
    ]);
    mockGetReport.mockResolvedValue(null);

    const result = await runReconciliation();

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'bcr_1', status: { in: NON_TERMINAL } },
      data: { lastSyncedAt: expect.any(Date) },
    });
    expect(result.unparseable).toBe(1);
  });

  it('terminalizes a still-invited row whose invitation expired', async () => {
    findMany.mockResolvedValue([
      {
        id: 'bcr_1',
        identityBackgroundCheckId: 'inv_1',
        checkrInvitationId: 'inv_1',
        status: 'invited',
      },
    ]);
    mockGetReport.mockResolvedValue(null);
    mockGetInvitation.mockResolvedValue({ id: 'inv_1', status: 'expired' });

    const result = await runReconciliation();

    // An expired invitation can never produce a report: the row advances
    // to failed instead of backing off forever.
    expect(mockGetInvitation).toHaveBeenCalledWith('inv_1');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'bcr_1', status: { in: NON_TERMINAL } },
      data: { status: 'failed', lastSyncedAt: expect.any(Date) },
    });
    expect(result.updated).toBe(1);
    expect(result.unparseable).toBe(0);
  });

  it('backs off a still-invited row whose invitation is still pending', async () => {
    findMany.mockResolvedValue([
      {
        id: 'bcr_1',
        identityBackgroundCheckId: 'inv_1',
        checkrInvitationId: 'inv_1',
        status: 'invited',
      },
    ]);
    mockGetReport.mockResolvedValue(null);
    mockGetInvitation.mockResolvedValue({ id: 'inv_1', status: 'pending' });

    const result = await runReconciliation();

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'bcr_1', status: { in: NON_TERMINAL } },
      data: { lastSyncedAt: expect.any(Date) },
    });
    expect(result.updated).toBe(0);
    expect(result.unparseable).toBe(1);
  });

  it('queries only stale, non-terminal checks with an Identity id', async () => {
    findMany.mockResolvedValue([]);
    await runReconciliation();
    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: { in: NON_TERMINAL },
        identityBackgroundCheckId: { not: null },
        OR: [
          { lastSyncedAt: null },
          { lastSyncedAt: { lt: expect.any(Date) } },
        ],
      },
      select: {
        id: true,
        identityBackgroundCheckId: true,
        checkrInvitationId: true,
        status: true,
        identityStatus: true,
        employmentStatus: true,
        referenceStatus: true,
        rightToWorkStatus: true,
        adjudicationStatus: true,
      },
    });
  });

  it('graduates an invitation-id pointer through the preferred resolveReport path', async () => {
    findMany.mockResolvedValue([
      {
        id: 'bcr_1',
        identityBackgroundCheckId: 'inv_1',
        checkrInvitationId: 'inv_1',
        status: 'invited',
      },
    ]);
    mockResolveReport.mockResolvedValue({
      report: { status: 'clear' },
      reportId: 'rep_9',
    });

    const result = await runReconciliation();

    expect(mockResolveReport).toHaveBeenCalledWith({
      reportId: 'inv_1',
      invitationId: 'inv_1',
    });
    expect(mockGetReport).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'bcr_1',
        status: { in: NON_TERMINAL },
        identityBackgroundCheckId: 'inv_1',
      },
      data: expect.objectContaining({
        identityBackgroundCheckId: 'rep_9',
        status: 'completed',
      }),
    });
    expect(result.updated).toBe(1);
  });

  it('backs off the row when the vendor fetch throws instead of refetching it every hour', async () => {
    findMany.mockResolvedValue([
      {
        id: 'bcr_1',
        identityBackgroundCheckId: 'check_1',
        checkrInvitationId: null,
        status: 'in_progress',
      },
    ]);
    mockResolveReport.mockRejectedValue(new Error('Checkr down'));

    const result = await runReconciliation();

    // A poison row must not wedge the run. The timestamp advances so the
    // row is not refetched and re-logged on every hourly pass — only the
    // status is left alone.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'bcr_1' }),
        data: { lastSyncedAt: expect.any(Date) },
      }),
    );
    expect(result).toEqual({
      success: true,
      checked: 1,
      updated: 0,
      unparseable: 0,
    });
  });

  it('backs off without terminalizing when the report snapshot is unavailable', async () => {
    findMany.mockResolvedValue([
      {
        id: 'bcr_1',
        identityBackgroundCheckId: 'check_1',
        checkrInvitationId: null,
        status: 'in_progress',
        identityStatus: null,
        employmentStatus: null,
        referenceStatus: null,
        rightToWorkStatus: null,
        adjudicationStatus: null,
      },
    ]);
    mockResolveReport.mockResolvedValue({
      report: { status: 'clear' },
      reportId: 'check_1',
    });
    mockFetchSnapshot.mockRejectedValue(new Error('Checkr blip'));

    const result = await runReconciliation();

    // The terminal transition waits: committing it now would leave a row
    // with no snapshot that reconcile never revisits once terminal.
    const writes = updateMany.mock.calls.map((call) => call[0]);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual(
      expect.objectContaining({
        data: { lastSyncedAt: expect.any(Date) },
      }),
    );
    expect(writes[0].data).not.toHaveProperty('status');
    expect(result).toEqual({
      success: true,
      checked: 1,
      updated: 0,
      unparseable: 0,
    });
  });
});
