import { validateGcpWriteStepParams } from './gcp-remediation-param-guardrails';

function step(overrides: Record<string, unknown> = {}) {
  return {
    method: 'PATCH',
    url: 'https://example.googleapis.com/v1/x',
    body: {},
    purpose: 'fix',
    ...overrides,
  } as Parameters<typeof validateGcpWriteStepParams>[0];
}

const IAM_URL =
  'https://cloudresourcemanager.googleapis.com/v3/projects/p:setIamPolicy';

const PRIOR_POLICY = {
  bindings: [
    { role: 'roles/viewer', members: ['alice@example.com'] },
    { role: 'roles/editor', members: ['bob@example.com'] },
  ],
  etag: 'abc123',
  version: 3,
};

// Binds the single prior policy to the fix target — without these the
// URL-bound lookup fails closed and every case below refuses as
// "no pre-fix policy" instead of reaching the comparison it pins.
const IAM_READ_STEPS = [
  {
    purpose: 'read',
    url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p:getIamPolicy',
  },
];

function iamStep(policy: Record<string, unknown>) {
  return step({
    method: 'POST',
    url: IAM_URL,
    body: { policy },
  });
}

describe('validateGcpWriteStepParams adversarial IAM shapes', () => {
  it('refuses a same-length binding swap', () => {
    const errors = validateGcpWriteStepParams(
      iamStep({
        bindings: [
          { role: 'roles/viewer', members: ['alice@example.com'] },
          { role: 'roles/editor', members: ['attacker@evil.example'] },
        ],
        etag: 'abc123',
        version: 3,
      }),
      {
        realState: { read: { ...PRIOR_POLICY } },
        readSteps: IAM_READ_STEPS,
        index: 0,
      },
    );
    expect(errors.join(' ')).toMatch(/adds or changes a binding/);
  });

  it('refuses an additive public grant', () => {
    const errors = validateGcpWriteStepParams(
      iamStep({
        bindings: [
          ...PRIOR_POLICY.bindings,
          { role: 'roles/viewer', members: ['allUsers'] },
        ],
        etag: 'abc123',
        version: 3,
      }),
      {
        realState: { read: { ...PRIOR_POLICY } },
        readSteps: IAM_READ_STEPS,
        index: 0,
      },
    );
    expect(errors.join(' ')).toMatch(/adds or changes a binding/);
  });

  it('allows removing a binding (narrowing only)', () => {
    const errors = validateGcpWriteStepParams(
      iamStep({
        bindings: [{ role: 'roles/viewer', members: ['alice@example.com'] }],
        etag: 'abc123',
        version: 3,
      }),
      {
        realState: { read: { ...PRIOR_POLICY } },
        readSteps: IAM_READ_STEPS,
        index: 0,
      },
    );
    expect(errors).toEqual([]);
  });

  it('refuses a fabricated etag', () => {
    const errors = validateGcpWriteStepParams(
      iamStep({
        bindings: PRIOR_POLICY.bindings,
        etag: 'forged',
        version: 3,
      }),
      {
        realState: { read: { ...PRIOR_POLICY } },
        readSteps: IAM_READ_STEPS,
        index: 0,
      },
    );
    expect(errors.join(' ')).toMatch(/etag does not match/);
  });

  it('refuses a version downgrade', () => {
    const errors = validateGcpWriteStepParams(
      iamStep({
        bindings: PRIOR_POLICY.bindings,
        etag: 'abc123',
        version: 1,
      }),
      {
        realState: { read: { ...PRIOR_POLICY } },
        readSteps: IAM_READ_STEPS,
        index: 0,
      },
    );
    expect(errors.join(' ')).toMatch(/version does not match/);
  });

  it('refuses auditConfigs replaced with a non-array value', () => {
    const errors = validateGcpWriteStepParams(
      iamStep({
        bindings: PRIOR_POLICY.bindings,
        etag: 'abc123',
        version: 3,
        auditConfigs: null,
      }),
      {
        realState: {
          read: {
            ...PRIOR_POLICY,
            auditConfigs: [{ service: 'allServices' }],
          },
        },
        readSteps: IAM_READ_STEPS,
        index: 0,
      },
    );
    expect(errors.join(' ')).toMatch(/auditConfigs/);
  });

  it('refuses a shortened auditConfigs array', () => {
    const errors = validateGcpWriteStepParams(
      iamStep({
        bindings: PRIOR_POLICY.bindings,
        etag: 'abc123',
        version: 3,
        auditConfigs: [],
      }),
      {
        realState: {
          read: {
            ...PRIOR_POLICY,
            auditConfigs: [{ service: 'allServices' }],
          },
        },
        readSteps: IAM_READ_STEPS,
        index: 0,
      },
    );
    expect(errors.join(' ')).toMatch(/auditConfigs/);
  });

  it('refuses introduced auditConfigs that exempt members from auditing', () => {
    // The prior policy carries no auditConfigs: enabling audit logging is
    // a fix, but exemptedMembers hide actors — the addition weakens
    // auditability instead of adding coverage.
    const errors = validateGcpWriteStepParams(
      iamStep({
        bindings: PRIOR_POLICY.bindings,
        etag: 'abc123',
        version: 3,
        auditConfigs: [
          {
            service: 'allServices',
            auditLogConfigs: [
              {
                logType: 'ADMIN_READ',
                exemptedMembers: ['user:attacker@evil.example'],
              },
            ],
          },
        ],
      }),
      {
        realState: { read: { ...PRIOR_POLICY } },
        readSteps: IAM_READ_STEPS,
        index: 0,
      },
    );
    expect(errors.join(' ')).toMatch(/exemptedMembers/);
  });

  it('allows introduced auditConfigs that only add coverage', () => {
    const errors = validateGcpWriteStepParams(
      iamStep({
        bindings: PRIOR_POLICY.bindings,
        etag: 'abc123',
        version: 3,
        auditConfigs: [
          {
            service: 'allServices',
            auditLogConfigs: [{ logType: 'ADMIN_READ' }],
          },
        ],
      }),
      {
        realState: { read: { ...PRIOR_POLICY } },
        readSteps: IAM_READ_STEPS,
        index: 0,
      },
    );
    expect(errors).toEqual([]);
  });

  it('routes percent-encoded :setIamPolicy through IAM validation', () => {
    // WHATWG keeps %3A encoded in pathname, but the server decodes it —
    // the guard must see the same action the fetch executes.
    const errors = validateGcpWriteStepParams(
      step({
        method: 'POST',
        url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p%3AsetIamPolicy',
        body: { policy: { bindings: [], etag: 'abc123', version: 3 } },
      }),
      {
        realState: { read: { ...PRIOR_POLICY } },
        readSteps: IAM_READ_STEPS,
        index: 0,
      },
    );
    expect(errors.join(' ')).toMatch(/drops "bindings"/);
  });
});

describe('validateGcpWriteStepParams firewall egress', () => {
  const COLLECTION =
    'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls';

  it('refuses open egress destinationRanges', () => {
    // Direction changes on updates refuse before range checks run, so
    // the range logic below is pinned through an insert instead.
    const errors = validateGcpWriteStepParams(
      step({
        method: 'POST',
        url: COLLECTION,
        body: {
          direction: 'EGRESS',
          destinationRanges: ['0.0.0.0/0'],
          allowed: [{ IPProtocol: 'tcp' }],
        },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/egress/);
  });

  it('ignores destinationRanges on ingress rules (GCP ignores the field)', () => {
    const errors = validateGcpWriteStepParams(
      step({
        method: 'POST',
        url: COLLECTION,
        body: {
          direction: 'INGRESS',
          sourceRanges: ['10.0.0.0/8'],
          destinationRanges: ['0.0.0.0/0'],
        },
      }),
      { index: 0 },
    );
    expect(errors).toEqual([]);
  });
});

describe('validateGcpWriteStepParams query smuggling', () => {
  it('refuses predefinedAcl embedded in the raw step URL', () => {
    const errors = validateGcpWriteStepParams(
      step({
        method: 'POST',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket?predefinedAcl=publicReadWrite',
        body: {},
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/public/);
  });
});

const DATASET_URL =
  'https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets/d';

function datasetStep(access: unknown) {
  return step({
    method: 'PATCH',
    url: DATASET_URL,
    body: { access },
  });
}

describe('single-principal dataset data grants', () => {
  it('refuses READER, dataViewer, and dataEditor granted to one address', () => {
    // Neither the public check nor the privileged-role check fires on a
    // data role for a single identity — granting it shares the dataset
    // with exactly that address, so the fix flow refuses. dataEditor is
    // read+write, the same exposure with a wider blast radius.
    for (const role of [
      'READER',
      'reader',
      'roles/bigquery.dataViewer',
      'roles/bigquery.dataEditor',
      'Roles/BigQuery.DataEditor',
    ]) {
      for (const identity of [
        { userByEmail: 'attacker@evil.example' },
        { groupByEmail: 'crew@evil.example' },
      ]) {
        const errors = validateGcpWriteStepParams(
          datasetStep([{ role, ...identity }]),
          { index: 0 },
        );
        expect(errors.join(' ')).toMatch(/single identity/);
      }
    }
  });

  it('still allows intra-project group reads and role-less entries', () => {
    expect(
      validateGcpWriteStepParams(
        datasetStep([{ role: 'READER', specialGroup: 'projectReaders' }]),
        { index: 0 },
      ),
    ).toEqual([]);
    expect(
      validateGcpWriteStepParams(datasetStep([{ role: 'READER' }]), {
        index: 0,
      }),
    ).toEqual([]);
  });

  it('lets rollback restores bypass the fix-flow grant gate', () => {
    // Restoring the exact prior value is proven by prior-state comparison,
    // not by the fix-flow gates — a valid rollback must not trip them.
    expect(
      validateGcpWriteStepParams(
        datasetStep([{ role: 'READER', userByEmail: 'writer@example.com' }]),
        { index: 0, isRollback: true },
      ),
    ).toEqual([]);
  });
});

describe('provisioning and destructive writes on unguarded hosts', () => {
  it('refuses creates on KMS, DNS, monitoring, and BigQuery', () => {
    for (const stepOverrides of [
      {
        method: 'POST',
        url: 'https://dns.googleapis.com/dns/v1/projects/p/managedZones',
        body: { name: 'z', dnsName: 'evil.example.' },
      },
      {
        method: 'POST',
        url: 'https://cloudkms.googleapis.com/v1/projects/p/locations/l/keyRings',
        body: {},
      },
      {
        method: 'POST',
        url: 'https://monitoring.googleapis.com/v3/projects/p/alertPolicies',
        body: {},
      },
      {
        method: 'PUT',
        url: 'https://monitoring.googleapis.com/v3/projects/p/alertPolicies/a',
        body: {},
      },
      {
        method: 'POST',
        url: 'https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets',
        body: {},
      },
    ]) {
      const errors = validateGcpWriteStepParams(step(stepOverrides), {
        index: 0,
      });
      expect(errors.join(' ')).toMatch(/provisioning, not remediation/);
    }
  });

  it('refuses deletes on unguarded hosts in both flows', () => {
    for (const isRollback of [undefined, true]) {
      const errors = validateGcpWriteStepParams(
        step({
          method: 'DELETE',
          url: 'https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets/d',
        }),
        { index: 0, ...(isRollback ? { isRollback: true } : {}) },
      );
      expect(errors.join(' ')).toMatch(/destructive/);
    }
  });

  it('lets rollback replays bypass the create refusal', () => {
    expect(
      validateGcpWriteStepParams(
        step({
          method: 'POST',
          url: 'https://dns.googleapis.com/dns/v1/projects/p/managedZones',
          body: { name: 'z' },
        }),
        { index: 0, isRollback: true },
      ),
    ).toEqual([]);
  });

  it('still allows benign PATCH on unguarded hosts', () => {
    expect(
      validateGcpWriteStepParams(
        step({
          method: 'PATCH',
          url: 'https://dns.googleapis.com/dns/v1/projects/p/managedZones/z',
          body: { dnssecConfig: { state: 'on' } },
        }),
        { index: 0 },
      ),
    ).toEqual([]);
  });
});
