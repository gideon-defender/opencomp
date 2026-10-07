import {
  assertRemediationPlanHash,
  hashRemediationPlanSteps,
} from './remediation-plan-hash';

const BINDING = {
  organizationId: 'org_1',
  connectionId: 'conn_1',
  checkResultId: 'chk_1',
  remediationKey: 'k',
};

const STEP = {
  method: 'PATCH',
  url: 'https://management.azure.com/x',
  body: { properties: { a: true } },
};

describe('hashRemediationPlanSteps', () => {
  it('isolates providers by prefix', () => {
    const azure = hashRemediationPlanSteps({
      provider: 'azure',
      fixSteps: [STEP],
      binding: BINDING,
    });
    const gcp = hashRemediationPlanSteps({
      provider: 'gcp',
      fixSteps: [STEP],
      binding: BINDING,
    });
    expect(azure).toMatch(/^azure-/);
    expect(gcp).toMatch(/^gcp-/);
    expect(azure).not.toBe(gcp);
  });

  it('binds rollback steps and the finding into the hash', () => {
    const base = hashRemediationPlanSteps({
      provider: 'azure',
      fixSteps: [STEP],
      binding: BINDING,
    });
    const withRollback = hashRemediationPlanSteps({
      provider: 'azure',
      fixSteps: [STEP],
      rollbackSteps: [STEP],
      binding: BINDING,
    });
    expect(withRollback).not.toBe(base);
    const otherFinding = hashRemediationPlanSteps({
      provider: 'azure',
      fixSteps: [STEP],
      binding: { ...BINDING, checkResultId: 'chk_2' },
    });
    expect(otherFinding).not.toBe(base);
  });

  it('ignores purpose rewording', () => {
    const a = hashRemediationPlanSteps({
      provider: 'azure',
      fixSteps: [{ ...STEP, purpose: 'fix it' }],
      binding: BINDING,
    });
    const b = hashRemediationPlanSteps({
      provider: 'azure',
      fixSteps: [{ ...STEP, purpose: 'remediate the thing' }],
      binding: BINDING,
    });
    expect(a).toBe(b);
  });
});

describe('assertRemediationPlanHash', () => {
  it('passes on match and throws on drift', () => {
    const expected = hashRemediationPlanSteps({
      provider: 'azure',
      fixSteps: [STEP],
      binding: BINDING,
    });
    expect(() =>
      assertRemediationPlanHash({
        provider: 'azure',
        expectedPlanHash: expected,
        binding: BINDING,
        fixSteps: [STEP],
      }),
    ).not.toThrow();
    expect(() =>
      assertRemediationPlanHash({
        provider: 'azure',
        expectedPlanHash: expected,
        binding: BINDING,
        fixSteps: [{ ...STEP, body: { properties: { a: false } } }],
      }),
    ).toThrow(/changed since you acknowledged it/);
  });
});
