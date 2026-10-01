import { HttpException, HttpStatus } from '@nestjs/common';
import { db } from '@db';
import { getTriggerService, logTriggerAuditEntry } from '../nest-context';
import { runCloudSecurityScan } from './run-cloud-security-scan';

jest.mock('@db', () => {
  const actual = jest.requireActual('@db');
  return {
    db: {
      integrationConnection: { findUnique: jest.fn() },
    },
    AuditLogEntityType: actual.AuditLogEntityType,
    CommentEntityType: actual.CommentEntityType,
  };
});

jest.mock('@gideon-defender/trigger-local', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  tags: { add: jest.fn() },
  task: (config: unknown) => config,
}));

jest.mock('../../cloud-security/cloud-security.controller', () => ({
  CloudSecurityController: class {},
}));

jest.mock('../nest-context', () => {
  const actual = jest.requireActual('../nest-context');
  return {
    getTriggerService: jest.fn(),
    logTriggerAuditEntry: jest.fn(),
    TRIGGER_SERVICE_NAME: actual.TRIGGER_SERVICE_NAME,
    createServiceTriggerRequest: actual.createServiceTriggerRequest,
    triggerHttpErrorMessage: actual.triggerHttpErrorMessage,
  };
});

const findUniqueMock = db.integrationConnection.findUnique as jest.Mock;
const getTriggerServiceMock = getTriggerService as jest.Mock;
const logTriggerAuditEntryMock = logTriggerAuditEntry as jest.Mock;

const run = (
  runCloudSecurityScan as unknown as {
    run: (payload: {
      connectionId: string;
      organizationId: string;
      providerSlug: string;
      connectionName: string;
    }) => Promise<Record<string, unknown>>;
  }
).run;

describe('runCloudSecurityScan', () => {
  const detectServices = jest.fn();
  const scan = jest.fn();

  const payload = {
    connectionId: 'conn_1',
    organizationId: 'org_1',
    providerSlug: 'aws',
    connectionName: 'prod-aws',
  };

  beforeEach(() => {
    detectServices.mockReset();
    scan.mockReset();
    detectServices.mockResolvedValue({ services: ['s3'] });
    scan.mockResolvedValue({
      success: true,
      provider: 'aws',
      findingsCount: 5,
      scannedAt: '2026-09-30T00:00:00.000Z',
    });
    getTriggerServiceMock.mockReturnValue({ detectServices, scan });
    findUniqueMock.mockResolvedValue({
      id: 'conn_1',
      status: 'active',
      provider: { slug: 'aws' },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns not-found when the connection is gone', async () => {
    findUniqueMock.mockResolvedValue(null);

    const result = await run(payload);

    expect(result).toEqual({
      success: false,
      error: 'Connection not found',
    });
    expect(detectServices).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  });

  it('skips inactive connections', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'conn_1',
      status: 'archived',
      provider: { slug: 'aws' },
    });

    const result = await run(payload);

    expect(result).toEqual({
      success: true,
      skipped: true,
      reason: 'Connection not active',
    });
    expect(scan).not.toHaveBeenCalled();
  });

  it('detects services, scans with the service request, and audits', async () => {
    const result = await run(payload);

    expect(detectServices).toHaveBeenCalledWith('conn_1', 'org_1');
    expect(scan).toHaveBeenCalledWith(
      'conn_1',
      'org_1',
      expect.objectContaining({
        organizationId: 'org_1',
        isServiceToken: true,
        serviceName: 'Local trigger Workers',
      }),
    );
    expect(logTriggerAuditEntryMock).toHaveBeenCalledWith({
      organizationId: 'org_1',
      resource: 'integration',
      method: 'POST',
      path: '/v1/cloud-security/scan/conn_1',
    });
    expect(result).toEqual({
      success: true,
      provider: 'aws',
      findingsCount: 5,
      scannedAt: '2026-09-30T00:00:00.000Z',
    });
  });

  it('proceeds with the scan when detection fails', async () => {
    detectServices.mockRejectedValue(new Error('Cost Explorer is down'));

    const result = await run(payload);

    expect(scan).toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, provider: 'aws' });
  });

  it('skips detection for azure', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'conn_1',
      status: 'active',
      provider: { slug: 'azure' },
    });

    await run({ ...payload, providerSlug: 'azure' });

    expect(detectServices).not.toHaveBeenCalled();
    expect(scan).toHaveBeenCalled();
  });

  it('maps scan failures to failure results without auditing', async () => {
    scan.mockRejectedValue(
      new HttpException('Scan failed', HttpStatus.INTERNAL_SERVER_ERROR),
    );

    const result = await run(payload);

    expect(result).toEqual({ success: false, error: 'Scan failed' });
    expect(logTriggerAuditEntryMock).not.toHaveBeenCalled();
  });
});
