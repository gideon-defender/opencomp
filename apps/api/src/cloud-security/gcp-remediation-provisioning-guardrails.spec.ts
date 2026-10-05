import { validateGcpProvisioningWrite } from './gcp-remediation-provisioning-guardrails';
import { validateGcpWriteStepParams } from './gcp-remediation-param-guardrails';

const PREFIX = 'Step 1 (PATCH /managedZones/z)';

function direct(
  args: Partial<Parameters<typeof validateGcpProvisioningWrite>[0]>,
) {
  return validateGcpProvisioningWrite({
    method: 'PATCH',
    prefix: PREFIX,
    ...args,
  });
}

function step(overrides: Record<string, unknown> = {}) {
  return {
    method: 'PATCH',
    url: 'https://dns.googleapis.com/dns/v1/projects/p/managedZones/z',
    body: {},
    purpose: 'fix',
    ...overrides,
  } as Parameters<typeof validateGcpWriteStepParams>[0];
}

describe('validateGcpProvisioningWrite PATCH posture', () => {
  it('refuses DNSSEC disablement on DNS', () => {
    const errors = direct({
      hostname: 'dns.googleapis.com',
      body: { dnssecConfig: { state: 'off' } },
    });
    expect(errors.join(' ')).toMatch(/DNSSEC/);
  });

  it('refuses DNSSEC disablement regardless of case', () => {
    const errors = direct({
      hostname: 'dns.googleapis.com',
      body: { dnssecConfig: { state: 'OFF' } },
    });
    expect(errors.join(' ')).toMatch(/DNSSEC/);
  });

  it('refuses DNSSEC clearing via a null config (same loss as off)', () => {
    const errors = direct({
      hostname: 'dns.googleapis.com',
      body: { dnssecConfig: null },
    });
    expect(errors.join(' ')).toMatch(/DNSSEC/);
  });

  it('still allows DNSSEC enablement (the repair direction)', () => {
    expect(
      direct({
        hostname: 'dns.googleapis.com',
        body: { dnssecConfig: { state: 'on' } },
      }),
    ).toEqual([]);
  });

  it('refuses KMS rotation removal', () => {
    for (const body of [
      { rotationPeriod: null },
      { rotationPeriod: '' },
      { rotationSchedule: null },
    ]) {
      const errors = direct({
        hostname: 'cloudkms.googleapis.com',
        body,
      });
      expect(errors.join(' ')).toMatch(/rotation/);
    }
  });

  it('still allows KMS rotation configuration', () => {
    expect(
      direct({
        hostname: 'cloudkms.googleapis.com',
        body: { rotationPeriod: '7776000s' },
      }),
    ).toEqual([]);
  });

  it('refuses alert-policy disablement on monitoring', () => {
    const errors = direct({
      hostname: 'monitoring.googleapis.com',
      body: { enabled: false },
    });
    expect(errors.join(' ')).toMatch(/silences detection/);
  });

  it('refuses dataset encryption removal on BigQuery', () => {
    const errors = direct({
      hostname: 'bigquery.googleapis.com',
      body: { defaultEncryptionConfiguration: null },
    });
    expect(errors.join(' ')).toMatch(/encryption/);
  });

  it('skips the weakening check on the rollback path', () => {
    // Rollback PATCH shapes are constrained by prior-state comparison
    // (`validatePatchRollback`) — refusing here would block restores.
    expect(
      direct({
        hostname: 'dns.googleapis.com',
        body: { dnssecConfig: { state: 'off' } },
        isRollback: true,
      }),
    ).toEqual([]);
  });
});

describe('validateGcpWriteStepParams (provisioning PATCH wiring)', () => {
  it('refuses DNSSEC disablement through the dispatcher', () => {
    const errors = validateGcpWriteStepParams(
      step({ body: { dnssecConfig: { state: 'off' } } }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/DNSSEC/);
  });

  it('still allows DNSSEC enablement through the dispatcher', () => {
    const errors = validateGcpWriteStepParams(
      step({ body: { dnssecConfig: { state: 'on' } } }),
      { index: 0 },
    );
    expect(errors).toEqual([]);
  });
});
