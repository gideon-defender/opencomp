jest.mock('@db', () => ({ db: {} }));

jest.mock('@aws-sdk/client-sts', () => ({
  STSClient: jest.fn(),
  AssumeRoleCommand: jest.fn((input: unknown) => ({ input })),
}));

import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { AWSSecurityService } from './aws-security.service';
import { sanitizeStsSessionName } from './aws-security.service';

const stsCtor = STSClient as unknown as jest.Mock;
const assumeCmd = AssumeRoleCommand as unknown as jest.Mock;
const stsSend = jest.fn();

const ROLE_ASSUMER_ARN = 'arn:aws:iam::999999999999:role/CompRoleAssumer';
const AUDITOR_ARN = 'arn:aws:iam::123456789012:role/OpenComp-Auditor';
const PAIR_ARN =
  'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1';
const PAIR_MAP = JSON.stringify({ 'Storage:us-east-1': PAIR_ARN });

function pairCreds(overrides: Record<string, unknown> = {}) {
  return {
    roleArn: AUDITOR_ARN,
    remediationRoles: PAIR_MAP,
    externalId: 'ext-1',
    ...overrides,
  };
}

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
      pairCreds(),
      'us-east-1',
      undefined,
      PAIR_ARN,
    );

    // The remediator role caps sessions at 1 hour — 900s fits inside the cap
    // and limits stolen-credential blast radius.
    expect(assumeRole).toHaveBeenCalledWith(
      expect.objectContaining({
        roleArn: PAIR_ARN,
        externalId: 'ext-1',
        durationSeconds: 900,
        sessionName: 'CompSecurityRemediation',
      }),
    );
  });

  it('throws when no remediation role ARN is configured', async () => {
    const service = new AWSSecurityService();
    const assumeRole = jest
      .spyOn(service, 'assumeRole')
      .mockResolvedValue({ accessKeyId: 'AK', secretAccessKey: 'SK' });

    await expect(
      service.assumeRemediationRole({ externalId: 'ext-1' }, 'us-east-1'),
    ).rejects.toThrow(/Remediation role ARN not configured/);
    expect(assumeRole).not.toHaveBeenCalled();
  });

  it('throws on whitespace-only remediation role ARNs without calling STS', async () => {
    const service = new AWSSecurityService();
    const assumeRole = jest
      .spyOn(service, 'assumeRole')
      .mockResolvedValue({ accessKeyId: 'AK', secretAccessKey: 'SK' });

    await expect(
      service.assumeRemediationRole(
        {
          roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
          remediationRoleArn: '   ',
          externalId: 'ext-1',
        },
        'us-east-1',
      ),
    ).rejects.toThrow(/Remediation role ARN not configured/);
    expect(assumeRole).not.toHaveBeenCalled();
  });

  it('throws when the External ID is missing', async () => {
    const service = new AWSSecurityService();
    const assumeRole = jest
      .spyOn(service, 'assumeRole')
      .mockResolvedValue({ accessKeyId: 'AK', secretAccessKey: 'SK' });

    await expect(
      service.assumeRemediationRole(
        pairCreds({ externalId: undefined }),
        'us-east-1',
        undefined,
        PAIR_ARN,
      ),
    ).rejects.toThrow(/External ID not configured/);
    expect(assumeRole).not.toHaveBeenCalled();
  });

  it('rejects an explicitly blank pair-role override instead of falling back', async () => {
    const service = new AWSSecurityService();
    const assumeRole = jest
      .spyOn(service, 'assumeRole')
      .mockResolvedValue({ accessKeyId: 'AK', secretAccessKey: 'SK' });

    // A blank override is a caller bug — it must throw instead of
    // resolving to something unintended.
    await expect(
      service.assumeRemediationRole(
        pairCreds(),
        'us-east-1',
        { findingId: 'chk_1' },
        '   ',
      ),
    ).rejects.toThrow(/got blank/);
    expect(assumeRole).not.toHaveBeenCalled();
  });

  it('rejects remediation when the auditor ARN is missing without calling STS', async () => {
    const service = new AWSSecurityService();
    const assumeRole = jest
      .spyOn(service, 'assumeRole')
      .mockResolvedValue({ accessKeyId: 'AK', secretAccessKey: 'SK' });

    // No auditor ARN means the same-account check cannot run — fail
    // closed instead of validating with fewer checks.
    await expect(
      service.assumeRemediationRole(
        pairCreds({ roleArn: undefined }),
        'us-east-1',
        undefined,
        PAIR_ARN,
      ),
    ).rejects.toThrow(/Auditor Role ARN is required/);
    expect(assumeRole).not.toHaveBeenCalled();
  });

  it('rejects a wrong-partition remediation ARN against the target region', async () => {
    const service = new AWSSecurityService();
    const assumeRole = jest
      .spyOn(service, 'assumeRole')
      .mockResolvedValue({ accessKeyId: 'AK', secretAccessKey: 'SK' });

    // No awsType stored: the partition anchors to the region (commercial),
    // so the GovCloud pair ARN must fail — not validate against
    // its own partition.
    const govArn =
      'arn:aws-us-gov:iam::123456789012:role/OpenComp-Remediator-Storage-us-gov-west-1';
    await expect(
      service.assumeRemediationRole(
        pairCreds({
          remediationRoles: JSON.stringify({
            'Storage:us-gov-west-1': govArn,
          }),
        }),
        'us-east-1',
        undefined,
        govArn,
      ),
    ).rejects.toThrow(/must match selected AWS environment/);
    expect(assumeRole).not.toHaveBeenCalled();
  });

  it('fails closed on remediation role confusion without calling STS', async () => {
    const service = new AWSSecurityService();
    const assumeRole = jest
      .spyOn(service, 'assumeRole')
      .mockResolvedValue({ accessKeyId: 'AK', secretAccessKey: 'SK' });

    // Cross-account pair ARN.
    const crossAccountArn =
      'arn:aws:iam::999999999999:role/OpenComp-Remediator-Storage-us-east-1';
    await expect(
      service.assumeRemediationRole(
        pairCreds({
          remediationRoles: JSON.stringify({
            'Storage:us-east-1': crossAccountArn,
          }),
        }),
        'us-east-1',
        undefined,
        crossAccountArn,
      ),
    ).rejects.toThrow(/must match the auditor/);

    // Auditor role reused as the pair role.
    await expect(
      service.assumeRemediationRole(
        pairCreds({
          remediationRoles: JSON.stringify({
            'Storage:us-east-1': AUDITOR_ARN,
          }),
        }),
        'us-east-1',
        undefined,
        AUDITOR_ARN,
      ),
    ).rejects.toThrow(/must differ from the auditor/);

    // Non-remediator role name.
    const adminArn = 'arn:aws:iam::123456789012:role/Admin';
    await expect(
      service.assumeRemediationRole(
        pairCreds({
          remediationRoles: JSON.stringify({ 'Storage:us-east-1': adminArn }),
        }),
        'us-east-1',
        undefined,
        adminArn,
      ),
    ).rejects.toThrow(/must reference OpenComp-Remediator/);

    expect(assumeRole).not.toHaveBeenCalled();
  });

  it('stamps the finding ID as the remediation session name', async () => {
    const service = new AWSSecurityService();
    const assumeRole = jest
      .spyOn(service, 'assumeRole')
      .mockResolvedValue({ accessKeyId: 'AK', secretAccessKey: 'SK' });

    await service.assumeRemediationRole(
      pairCreds(),
      'us-east-1',
      { findingId: 'chk_abc123' },
      PAIR_ARN,
    );

    expect(assumeRole).toHaveBeenCalledWith(
      expect.objectContaining({
        roleArn: PAIR_ARN,
        externalId: 'ext-1',
        durationSeconds: 900,
        sessionName: 'chk_abc123',
      }),
    );
  });

  it('sanitizes session names to the STS charset and length', () => {
    expect(sanitizeStsSessionName('chk_abc123', 'fallback')).toBe('chk_abc123');
    // Spaces and slashes are replaced; output fits the 64-char cap.
    expect(sanitizeStsSessionName('a b/c', 'fallback')).toBe('a-b-c');
    expect(sanitizeStsSessionName('x'.repeat(100), 'fallback')).toHaveLength(
      64,
    );
    // Nothing usable left (or too short) → fallback so STS never 400s.
    expect(sanitizeStsSessionName('', 'fallback')).toBe('fallback');
    expect(sanitizeStsSessionName('!', 'fallback')).toBe('fallback');
    expect(sanitizeStsSessionName(undefined, 'fallback')).toBe('fallback');
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

  it('trims padded role ARNs and External IDs before the STS call', async () => {
    // Heals vault rows written before whitespace normalization: STS
    // rejects a trailing space verbatim, so the wire value must be clean.
    const service = new AWSSecurityService();

    await service.assumeRole({
      roleArn: '  arn:aws:iam::123456789012:role/OpenComp-Auditor  ',
      externalId: '  ext-1  ',
      region: 'us-east-1',
    });

    const hop2 = assumeCmd.mock.calls[1]?.[0] as
      { RoleArn?: string; ExternalId?: string } | undefined;
    expect(hop2?.RoleArn).toBe(
      'arn:aws:iam::123456789012:role/OpenComp-Auditor',
    );
    expect(hop2?.ExternalId).toBe('ext-1');
  });

  it('assumes the explicitly passed pair ARN', async () => {
    const service = new AWSSecurityService();
    const assumeRole = jest
      .spyOn(service, 'assumeRole')
      .mockResolvedValue({ accessKeyId: 'AK', secretAccessKey: 'SK' });

    await service.assumeRemediationRole(
      pairCreds(),
      'us-east-1',
      { findingId: 'chk_abc123' },
      PAIR_ARN,
    );

    expect(assumeRole).toHaveBeenCalledWith(
      expect.objectContaining({
        roleArn: PAIR_ARN,
        sessionName: 'chk_abc123',
      }),
    );
  });

  it('validates the passed pair ARN with the same fail-closed rules', async () => {
    const service = new AWSSecurityService();
    const assumeRole = jest
      .spyOn(service, 'assumeRole')
      .mockResolvedValue({ accessKeyId: 'AK', secretAccessKey: 'SK' });

    // Cross-account pair ARN must not reach STS, even when explicitly passed.
    const crossAccountArn =
      'arn:aws:iam::999999999999:role/OpenComp-Remediator-Storage-us-east-1';
    await expect(
      service.assumeRemediationRole(
        pairCreds({
          remediationRoles: JSON.stringify({
            'Storage:us-east-1': crossAccountArn,
          }),
        }),
        'us-east-1',
        undefined,
        crossAccountArn,
      ),
    ).rejects.toThrow(/must match the auditor/);
    expect(assumeRole).not.toHaveBeenCalled();
  });

  it('refuses an ARN that is not a configured pair for the connection', async () => {
    const service = new AWSSecurityService();
    const assumeRole = jest
      .spyOn(service, 'assumeRole')
      .mockResolvedValue({ accessKeyId: 'AK', secretAccessKey: 'SK' });

    // Valid pair name, but no map entry holds it — the ARN must come from
    // the connection's own configured pairs, never from a bare argument.
    await expect(
      service.assumeRemediationRole(
        pairCreds(),
        'us-east-1',
        undefined,
        AUDITOR_ARN,
      ),
    ).rejects.toThrow(/not a configured pair/);
    expect(assumeRole).not.toHaveBeenCalled();
  });
});
