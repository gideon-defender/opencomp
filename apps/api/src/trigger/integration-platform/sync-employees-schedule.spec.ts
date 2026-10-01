import { getTriggerService, logTriggerAuditEntry } from '../nest-context';
import { syncProvider } from './sync-employees-schedule';

jest.mock('@gideon-defender/trigger-local', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  schedules: {
    task: (config: unknown) => config,
  },
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

const getTriggerServiceMock = getTriggerService as jest.Mock;
const logTriggerAuditEntryMock = logTriggerAuditEntry as jest.Mock;

describe('syncProvider', () => {
  const syncGoogleWorkspaceEmployees = jest.fn();
  const syncRipplingEmployees = jest.fn();
  const syncJumpCloudEmployees = jest.fn();
  const syncDynamicProviderEmployees = jest.fn();

  const params = {
    connectionId: 'conn_1',
    organizationId: 'org_1',
  };

  beforeEach(() => {
    for (const fn of [
      syncGoogleWorkspaceEmployees,
      syncRipplingEmployees,
      syncJumpCloudEmployees,
      syncDynamicProviderEmployees,
    ]) {
      fn.mockReset();
      fn.mockResolvedValue({
        success: true,
        imported: 3,
        reactivated: 1,
        deactivated: 0,
        skipped: 2,
        errors: 0,
        totalFound: 6,
        syncRunId: 'run_1',
      });
    }
    getTriggerServiceMock.mockReturnValue({
      syncGoogleWorkspaceEmployees,
      syncRipplingEmployees,
      syncJumpCloudEmployees,
      syncDynamicProviderEmployees,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('routes google-workspace and normalizes the result', async () => {
    const result = await syncProvider({
      ...params,
      providerSlug: 'google-workspace',
    });

    expect(syncGoogleWorkspaceEmployees).toHaveBeenCalledWith(
      'org_1',
      'conn_1',
    );
    // Drops handler-only fields (totalFound, syncRunId), keeps the rest.
    expect(result).toEqual({
      success: true,
      imported: 3,
      reactivated: 1,
      deactivated: 0,
      skipped: 2,
      errors: 0,
    });
    expect(logTriggerAuditEntryMock).toHaveBeenCalledWith({
      organizationId: 'org_1',
      resource: 'integration',
      method: 'POST',
      path: '/v1/integrations/sync/google-workspace/employees?connectionId=conn_1',
    });
  });

  it('routes rippling', async () => {
    await syncProvider({ ...params, providerSlug: 'rippling' });

    expect(syncRipplingEmployees).toHaveBeenCalledWith('org_1', 'conn_1');
    expect(logTriggerAuditEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/v1/integrations/sync/rippling/employees?connectionId=conn_1',
      }),
    );
  });

  it('routes jumpcloud', async () => {
    await syncProvider({ ...params, providerSlug: 'jumpcloud' });

    expect(syncJumpCloudEmployees).toHaveBeenCalledWith('org_1', 'conn_1');
    expect(logTriggerAuditEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/v1/integrations/sync/jumpcloud/employees?connectionId=conn_1',
      }),
    );
  });

  it('routes unknown providers to the dynamic handler', async () => {
    await syncProvider({ ...params, providerSlug: 'bamboohr' });

    expect(syncDynamicProviderEmployees).toHaveBeenCalledWith(
      'org_1',
      'bamboohr',
      'conn_1',
    );
    expect(logTriggerAuditEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/v1/integrations/sync/dynamic/bamboohr/employees?connectionId=conn_1',
      }),
    );
  });

  it('defaults missing counts to zero', async () => {
    syncGoogleWorkspaceEmployees.mockResolvedValue({ success: true });

    const result = await syncProvider({
      ...params,
      providerSlug: 'google-workspace',
    });

    expect(result).toEqual({
      success: true,
      imported: 0,
      reactivated: 0,
      deactivated: 0,
      skipped: 0,
      errors: 0,
    });
  });

  it('wraps handler failures with the provider label', async () => {
    syncGoogleWorkspaceEmployees.mockRejectedValue(new Error('boom'));

    await expect(
      syncProvider({ ...params, providerSlug: 'google-workspace' }),
    ).rejects.toThrow('Google Workspace sync failed: 500 - boom');
    expect(logTriggerAuditEntryMock).not.toHaveBeenCalled();
  });
});
