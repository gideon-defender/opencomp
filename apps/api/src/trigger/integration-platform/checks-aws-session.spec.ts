import { ConnectionNotFoundError } from '../../cloud-security/cloud-security.service';
import { getTriggerService, logTriggerAuditEntry } from '../nest-context';
import {
  injectAwsResolvedSession,
  RESOLVED_AWS_SESSION_KEYS,
} from './checks-aws-session';

jest.mock('../../cloud-security/cloud-security.service', () => ({
  CloudSecurityService: class {},
  ConnectionNotFoundError: class ConnectionNotFoundError extends Error {},
}));

jest.mock('../nest-context', () => ({
  getTriggerService: jest.fn(),
  logTriggerAuditEntry: jest.fn(),
  triggerHttpErrorMessage:
    jest.requireActual('../nest-context').triggerHttpErrorMessage,
}));

const getTriggerServiceMock = getTriggerService as jest.Mock;
const logTriggerAuditEntryMock = logTriggerAuditEntry as jest.Mock;

describe('injectAwsResolvedSession', () => {
  const resolveAwsSession = jest.fn();

  const params = {
    connectionId: 'conn_1',
    organizationId: 'org_1',
    providerSlug: 'aws',
  };

  beforeEach(() => {
    resolveAwsSession.mockReset();
    getTriggerServiceMock.mockReturnValue({ resolveAwsSession });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('leaves non-AWS providers untouched without calling the service', async () => {
    const credentials = { access_token: 'token' };

    const result = await injectAwsResolvedSession({
      credentials,
      connectionId: 'conn_1',
      organizationId: 'org_1',
      providerSlug: 'google-workspace',
    });

    expect(result).toBe(credentials);
    expect(getTriggerServiceMock).not.toHaveBeenCalled();
    expect(logTriggerAuditEntryMock).not.toHaveBeenCalled();
  });

  it('injects the resolved session keys on success and audits the call', async () => {
    resolveAwsSession.mockResolvedValue({
      ok: true,
      session: {
        accessKeyId: 'AKIA',
        secretAccessKey: 'secret',
        sessionToken: 'token',
      },
    });
    const credentials: Record<string, string | string[]> = {};

    const result = await injectAwsResolvedSession({ ...params, credentials });

    expect(resolveAwsSession).toHaveBeenCalledWith('conn_1', 'org_1');
    expect(result).toBe(credentials);
    expect(credentials[RESOLVED_AWS_SESSION_KEYS.accessKeyId]).toBe('AKIA');
    expect(credentials[RESOLVED_AWS_SESSION_KEYS.secretAccessKey]).toBe(
      'secret',
    );
    expect(credentials[RESOLVED_AWS_SESSION_KEYS.sessionToken]).toBe('token');
    expect(logTriggerAuditEntryMock).toHaveBeenCalledWith({
      organizationId: 'org_1',
      resource: 'integration',
      method: 'POST',
      path: '/v1/cloud-security/resolve-session/conn_1',
    });
  });

  it('injects the assume-failure reason', async () => {
    resolveAwsSession.mockResolvedValue({
      ok: false,
      reason: 'assume_failed',
      error: 'AccessDenied: not authorized',
    });
    const credentials: Record<string, string | string[]> = {};

    await injectAwsResolvedSession({ ...params, credentials });

    expect(credentials[RESOLVED_AWS_SESSION_KEYS.error]).toBe(
      'AccessDenied: not authorized',
    );
  });

  it('falls back to a default assume-failure message', async () => {
    resolveAwsSession.mockResolvedValue({
      ok: false,
      reason: 'assume_failed',
    });
    const credentials: Record<string, string | string[]> = {};

    await injectAwsResolvedSession({ ...params, credentials });

    expect(credentials[RESOLVED_AWS_SESSION_KEYS.error]).toBe(
      'The cross-account IAM role could not be assumed.',
    );
  });

  it('injects nothing for not-configured connections', async () => {
    resolveAwsSession.mockResolvedValue({
      ok: false,
      reason: 'not_configured',
    });
    const credentials: Record<string, string | string[]> = {};

    const result = await injectAwsResolvedSession({ ...params, credentials });

    expect(result).toBe(credentials);
    expect(credentials).toEqual({});
  });

  it('maps a missing connection to the not-found message', async () => {
    resolveAwsSession.mockRejectedValue(new ConnectionNotFoundError());
    const credentials: Record<string, string | string[]> = {};

    await injectAwsResolvedSession({ ...params, credentials });

    expect(credentials[RESOLVED_AWS_SESSION_KEYS.error]).toBe(
      'Could not resolve AWS session (connection not found).',
    );
    expect(logTriggerAuditEntryMock).not.toHaveBeenCalled();
  });

  it('maps generic failures to their message', async () => {
    resolveAwsSession.mockRejectedValue(new Error('STS is down'));
    const credentials: Record<string, string | string[]> = {};

    await injectAwsResolvedSession({ ...params, credentials });

    expect(credentials[RESOLVED_AWS_SESSION_KEYS.error]).toBe('STS is down');
  });
});
