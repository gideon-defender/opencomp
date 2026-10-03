jest.mock('@db', () => ({ db: {} }));

jest.mock('@aws-sdk/client-sts', () => ({
  STSClient: jest.fn(),
  AssumeRoleCommand: jest.fn((input: unknown) => ({ input })),
}));

import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { AWSSecurityService } from './aws-security.service';

const stsCtor = STSClient as unknown as jest.Mock;
const assumeCmd = AssumeRoleCommand as unknown as jest.Mock;
const stsSend = jest.fn();

const ROLE_ASSUMER_ARN = 'arn:aws:iam::999999999999:role/CompRoleAssumer';

function stsCredentials() {
  return {
    Credentials: {
      AccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      SecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      SessionToken: 'session-token',
    },
  };
}

describe('AWSSecurityService session durations', () => {
  const previousAssumerArn = process.env.SECURITY_HUB_ROLE_ASSUMER_ARN;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SECURITY_HUB_ROLE_ASSUMER_ARN = ROLE_ASSUMER_ARN;
    stsCtor.mockImplementation(() => ({ send: stsSend }));
    stsSend.mockResolvedValue(stsCredentials());
  });

  afterAll(() => {
    if (previousAssumerArn === undefined) {
      delete process.env.SECURITY_HUB_ROLE_ASSUMER_ARN;
    } else {
      process.env.SECURITY_HUB_ROLE_ASSUMER_ARN = previousAssumerArn;
    }
  });

  it('requests 15-minute sessions for the remediation role', async () => {
    const service = new AWSSecurityService();
    const assumeRole = jest
      .spyOn(service, 'assumeRole')
      .mockResolvedValue({ accessKeyId: 'AK', secretAccessKey: 'SK' });

    await service.assumeRemediationRole(
      {
        remediationRoleArn:
          'arn:aws:iam::123456789012:role/OpenComp-Remediator',
        externalId: 'ext-1',
      },
      'us-east-1',
    );

    // The remediator role caps sessions at 1 hour — 900s fits inside the cap
    // and limits stolen-credential blast radius.
    expect(assumeRole).toHaveBeenCalledWith(
      expect.objectContaining({
        durationSeconds: 900,
        sessionName: 'CompSecurityRemediation',
      }),
    );
  });

  it('throws when no remediation role ARN is configured', async () => {
    const service = new AWSSecurityService();

    await expect(
      service.assumeRemediationRole({ externalId: 'ext-1' }, 'us-east-1'),
    ).rejects.toThrow(/Remediation role ARN not configured/);
  });

  it('defaults to 1-hour sessions on the audit path', async () => {
    const service = new AWSSecurityService();

    await service.assumeRole({
      roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
      externalId: 'ext-1',
      region: 'us-east-1',
    });

    // Hop 1 targets the roleAssumer, hop 2 the customer role.
    expect(assumeCmd).toHaveBeenCalledTimes(2);
    const hop2 = assumeCmd.mock.calls[1]?.[0] as
      { DurationSeconds?: number } | undefined;
    expect(hop2?.DurationSeconds).toBe(3600);
  });

  it('passes an explicit duration through to the customer-role hop', async () => {
    const service = new AWSSecurityService();

    await service.assumeRole({
      roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Remediator',
      externalId: 'ext-1',
      region: 'us-east-1',
      durationSeconds: 900,
    });

    const hop2 = assumeCmd.mock.calls[1]?.[0] as
      { DurationSeconds?: number } | undefined;
    expect(hop2?.DurationSeconds).toBe(900);
  });
});
