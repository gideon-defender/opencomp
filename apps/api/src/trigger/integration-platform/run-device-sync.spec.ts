// Mock the Local trigger SDK at the module boundary so importing the task does
// not require a trigger runtime. `task()` simply returns its config object,
// which lets us assert on the static configuration (e.g. maxDuration) and
// invoke `run` directly.
jest.mock('@gideon-defender/trigger-local', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  tags: { add: jest.fn() },
  task: (config: unknown) => config,
}));

jest.mock('../../integration-platform/controllers/sync.controller', () => ({
  SyncController: class {},
}));

jest.mock('../nest-context', () => ({
  getTriggerService: jest.fn(),
  logTriggerAuditEntry: jest.fn(),
  triggerHttpErrorMessage:
    jest.requireActual('../nest-context').triggerHttpErrorMessage,
  triggerHttpErrorStatus:
    jest.requireActual('../nest-context').triggerHttpErrorStatus,
}));

import { getTriggerService, logTriggerAuditEntry } from '../nest-context';
import { runDeviceSync } from './run-device-sync';

const getTriggerServiceMock = getTriggerService as jest.Mock;
const logTriggerAuditEntryMock = logTriggerAuditEntry as jest.Mock;

const config = runDeviceSync as unknown as { id: string; maxDuration: number };

const run = (
  runDeviceSync as unknown as {
    run: (payload: {
      organizationId: string;
      connectionId: string;
      providerSlug: string;
    }) => Promise<Record<string, unknown>>;
  }
).run;

describe('runDeviceSync task config', () => {
  it('declares maxDuration in SECONDS, not milliseconds', () => {
    // Local trigger maxDuration is in seconds. 10 minutes = 600.
    // The ms form (1000 * 60 * 10 = 600_000) would be ~7 days.
    expect(config.maxDuration).toBe(600);
    expect(config.maxDuration).toBeLessThan(24 * 60 * 60);
  });
});

describe('runDeviceSync run', () => {
  const syncDynamicProviderDevices = jest.fn();

  const payload = {
    organizationId: 'org_1',
    connectionId: 'conn_1',
    providerSlug: 'jamf',
  };

  beforeEach(() => {
    syncDynamicProviderDevices.mockReset();
    getTriggerServiceMock.mockReturnValue({ syncDynamicProviderDevices });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('delegates to the sync handler and maps the result', async () => {
    syncDynamicProviderDevices.mockResolvedValue({
      success: true,
      totalFound: 10,
      imported: 4,
      updated: 3,
      removed: 1,
      skipped: 2,
      errors: 0,
      syncRunId: 'run_1',
    });

    const result = await run(payload);

    expect(syncDynamicProviderDevices).toHaveBeenCalledWith(
      'org_1',
      'jamf',
      'conn_1',
    );
    expect(result).toEqual({
      success: true,
      totalFound: 10,
      imported: 4,
      updated: 3,
      removed: 1,
      skipped: 2,
      errors: 0,
      syncRunId: 'run_1',
    });
    expect(logTriggerAuditEntryMock).toHaveBeenCalledWith({
      organizationId: 'org_1',
      resource: 'integration',
      method: 'POST',
      path: '/v1/integrations/sync/dynamic/jamf/devices?connectionId=conn_1',
    });
  });

  it('returns a failure result instead of throwing', async () => {
    syncDynamicProviderDevices.mockRejectedValue(new Error('boom'));

    const result = await run(payload);

    expect(result).toEqual({
      success: false,
      error: 'Device sync failed: 500 - boom',
    });
    expect(logTriggerAuditEntryMock).not.toHaveBeenCalled();
  });
});
