import { HttpException, HttpStatus } from '@nestjs/common';
import { getTriggerService, logTriggerAuditEntry } from '../nest-context';
import { runChecksOnServer } from './run-checks-on-server';

jest.mock('../nest-context', () => ({
  getTriggerService: jest.fn(),
  logTriggerAuditEntry: jest.fn(),
  triggerHttpErrorMessage:
    jest.requireActual('../nest-context').triggerHttpErrorMessage,
}));

const getTriggerServiceMock = getTriggerService as jest.Mock;
const logTriggerAuditEntryMock = logTriggerAuditEntry as jest.Mock;

describe('runChecksOnServer', () => {
  const params = {
    connectionId: 'conn_1',
    organizationId: 'org_1',
  };

  const runChecks = jest.fn();

  beforeEach(() => {
    jest.useRealTimers();
    runChecks.mockReset();
    getTriggerServiceMock.mockReturnValue({ runChecks });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('delegates to the check-runner service in-process and returns the result', async () => {
    const runResult = { results: [{}], totalFindings: 1, totalPassing: 2 };
    runChecks.mockResolvedValue(runResult);

    const result = await runChecksOnServer({
      ...params,
      checkId: 'aws-s3-public-access',
    });

    expect(getTriggerServiceMock).toHaveBeenCalledTimes(1);
    expect(runChecks).toHaveBeenCalledWith({
      connectionId: 'conn_1',
      organizationId: 'org_1',
      checkId: 'aws-s3-public-access',
    });
    expect(result).toEqual(runResult);
    expect(logTriggerAuditEntryMock).toHaveBeenCalledWith({
      organizationId: 'org_1',
      resource: 'integration',
      method: 'POST',
      path: '/v1/integrations/internal/run-connection-checks/conn_1',
    });
  });

  it('omits checkId when running all checks and returns the result', async () => {
    runChecks.mockResolvedValue({ results: [] });

    const result = await runChecksOnServer(params);

    expect(runChecks).toHaveBeenCalledWith({
      connectionId: 'conn_1',
      organizationId: 'org_1',
      checkId: undefined,
    });
    expect(result).toEqual({ results: [] });
  });

  it('throws with the service message on failure', async () => {
    runChecks.mockRejectedValue(
      new HttpException('boom', HttpStatus.INTERNAL_SERVER_ERROR),
    );

    await expect(runChecksOnServer(params)).rejects.toThrow('boom');
    expect(logTriggerAuditEntryMock).not.toHaveBeenCalled();
  });

  it('throws a timeout error when the run hangs', async () => {
    jest.useFakeTimers();
    runChecks.mockReturnValue(new Promise(() => {}));

    const promise = runChecksOnServer(params);
    // Surface the rejection without an unhandled-rejection warning.
    const assertion = expect(promise).rejects.toThrow('timed out');
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    await assertion;

    jest.useRealTimers();
  });

  it('throws when the Nest context is not initialized', async () => {
    getTriggerServiceMock.mockImplementation(() => {
      throw new Error('Trigger Nest context is not initialized');
    });

    await expect(runChecksOnServer(params)).rejects.toThrow(
      'Trigger Nest context is not initialized',
    );
  });
});
