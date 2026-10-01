import { HttpException, HttpStatus } from '@nestjs/common';
import { getTriggerService, logTriggerAuditEntry } from '../nest-context';
import { requestValidCredentials } from './ensure-valid-credentials';

// Mock the controller module: importing the real one pulls in
// hybrid-auth.guard → auth.server.ts, which throws at load time when
// SECRET_KEY is unset. The token is only used as a DI key here.
jest.mock(
  '../../integration-platform/controllers/connections.controller',
  () => ({
    ConnectionsController: class {},
  }),
);

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

describe('requestValidCredentials', () => {
  const ensureValidCredentials = jest.fn();

  beforeEach(() => {
    ensureValidCredentials.mockReset();
    ensureValidCredentials.mockResolvedValue({
      success: true,
      accessToken: 'token',
      credentials: { access_token: 'token' },
    });
    getTriggerServiceMock.mockReturnValue({ ensureValidCredentials });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns decrypted credentials from the in-process handler', async () => {
    const result = await requestValidCredentials({
      connectionId: 'conn_1',
      organizationId: 'org_1',
    });

    expect(ensureValidCredentials).toHaveBeenCalledWith('conn_1', 'org_1', {
      forceRefresh: false,
    });
    expect(result).toEqual({
      success: true,
      credentials: { access_token: 'token' },
    });
    expect(logTriggerAuditEntryMock).toHaveBeenCalledWith({
      organizationId: 'org_1',
      resource: 'integration',
      method: 'POST',
      path: '/v1/integrations/connections/conn_1/ensure-valid-credentials',
    });
  });

  it('forwards forceRefresh and returns the credentials', async () => {
    const result = await requestValidCredentials({
      connectionId: 'conn_1',
      organizationId: 'org_1',
      forceRefresh: true,
    });

    expect(ensureValidCredentials).toHaveBeenCalledWith('conn_1', 'org_1', {
      forceRefresh: true,
    });
    expect(result).toEqual({
      success: true,
      credentials: { access_token: 'token' },
    });
  });

  it('maps handler errors to failure results with status', async () => {
    ensureValidCredentials.mockRejectedValue(
      new HttpException('Token refresh failed', HttpStatus.UNAUTHORIZED),
    );

    await expect(
      requestValidCredentials({
        connectionId: 'conn_1',
        organizationId: 'org_1',
      }),
    ).resolves.toEqual({
      success: false,
      status: 401,
      error: 'Token refresh failed',
    });
    expect(logTriggerAuditEntryMock).not.toHaveBeenCalled();
  });

  it('fails when the handler response has no credentials', async () => {
    ensureValidCredentials.mockResolvedValue({
      success: true,
      credentials: null,
    });

    await expect(
      requestValidCredentials({
        connectionId: 'conn_1',
        organizationId: 'org_1',
      }),
    ).resolves.toEqual({
      success: false,
      error: 'Valid credentials response did not include credentials',
    });
  });
});
