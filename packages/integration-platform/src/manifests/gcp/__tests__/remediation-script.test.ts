import { describe, expect, it } from 'vitest';
import { getGcpRemediationScriptForPair } from '../remediation-script';

describe('getGcpRemediationScriptForPair', () => {
  it('builds a per-pair binding script with the SA email and role', () => {
    const script = getGcpRemediationScriptForPair({
      pair: { assetClass: 'Storage', projectId: 'my-proj-123' },
      impersonatorServiceAccount: 'impersonator@backend.iam.gserviceaccount.com',
    });
    expect(script).toContain('opencomp-remediator@my-proj-123.iam.gserviceaccount.com');
    expect(script).toContain('opencomp.remediator.storage');
    expect(script).toContain('roles/iam.serviceAccountTokenCreator');
  });

  it('rejects project ids that could break out of shell quoting', () => {
    for (const projectId of [
      'evil"; touch pwned; echo "',
      'evil$(touch pwned)',
      'evil`touch pwned`',
      'evil\ntouch pwned',
      'UPPERCASE-PROJ',
      'ab',
    ]) {
      expect(() =>
        getGcpRemediationScriptForPair({
          pair: { assetClass: 'Storage', projectId },
          impersonatorServiceAccount: 'impersonator@backend.iam.gserviceaccount.com',
        }),
      ).toThrow(/valid GCP project id/);
    }
  });
});
