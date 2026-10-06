import { describe, expect, it } from 'vitest';
import { getAzureRemediationScriptForPair } from '../remediation-script';

const SUB = '12345678-1234-1234-1234-1234567890ab';

describe('getAzureRemediationScriptForPair', () => {
  it('creates the class SP, custom role, and assignment for the pair', () => {
    const script = getAzureRemediationScriptForPair({
      pair: { assetClass: 'Storage', subscriptionId: SUB },
    });
    expect(script).toContain('opencomp-remediator-storage');
    expect(script).toContain(`SUBSCRIPTION="${SUB}"`);
    expect(script).toContain('az ad app create');
    expect(script).toContain('az ad sp create');
    expect(script).toContain('az role definition list');
    expect(script).toContain('az role definition create');
    expect(script).toContain('az role assignment create');
    expect(script).toContain('OpenComp Remediator (Storage)');
    expect(script).toContain(`Storage:${SUB}=$APP_ID`);
  });

  it('is rerun-safe (reuses existing app, SP, and role definition)', () => {
    const script = getAzureRemediationScriptForPair({
      pair: { assetClass: 'Data', subscriptionId: SUB },
    });
    // Existing identities are looked up first; creation only runs when
    // the lookup comes back empty so `set -euo pipefail` never aborts a
    // rerun midway.
    expect(script).toContain('az ad app list');
    expect(script).toContain('az ad sp list');
    expect(script).toContain('az role definition update');
  });

  it('carries the approval warning for gated classes only', () => {
    const network = getAzureRemediationScriptForPair({
      pair: { assetClass: 'Network', subscriptionId: SUB },
    });
    expect(network).toContain('approval-gated');
    const securityGlobal = getAzureRemediationScriptForPair({
      pair: { assetClass: 'Security-Global', subscriptionId: SUB },
    });
    expect(securityGlobal).toContain('approval-gated');
    const storage = getAzureRemediationScriptForPair({
      pair: { assetClass: 'Storage', subscriptionId: SUB },
    });
    expect(storage).not.toContain('approval-gated');
  });

  it('throws on invalid subscription ids instead of emitting a broken script', () => {
    expect(() =>
      getAzureRemediationScriptForPair({
        pair: { assetClass: 'Storage', subscriptionId: 'BAD ID' },
      }),
    ).toThrow(/valid Azure subscription id/);
  });

  it('never grants a privileged built-in role in the generated script', () => {
    for (const assetClass of [
      'Storage',
      'Compute',
      'Network',
      'Data',
      'Security-Global',
    ] as const) {
      const script = getAzureRemediationScriptForPair({
        pair: { assetClass, subscriptionId: SUB },
      });
      expect(script).not.toMatch(/--role\s+"?(Owner|Contributor)"?/);
    }
  });
});
