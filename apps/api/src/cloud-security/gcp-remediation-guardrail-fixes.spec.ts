import { validateGcpPlanSteps } from './gcp-plan-step-validation';
import { validateGcpComputePatch } from './gcp-remediation-compute-guardrails';
import {
  validateGcpBucketPatch,
  validateGcpStorageObjectUrl,
} from './gcp-remediation-bucket-guardrails';
import { validateGcpFirewallPatch } from './gcp-remediation-firewall-guardrails';
import {
  validateGcpRollbackOverlap,
  validateGcpRollbackSteps,
} from './gcp-remediation-rollback-validators';
import {
  buildEffectiveGcpStepUrl,
  stepQueryParamValues,
} from './gcp-remediation-validator-shared';
import {
  findPriorPolicyForUrl,
  findPriorStateValue,
} from './gcp-remediation-prior-state';
import {
  hashGcpPlanSteps,
  redactGcpUrlForLog,
  sanitizeGcpPurposeForLog,
} from './gcp-remediation-plan.utils';
import { validateGcpWriteStepParams } from './gcp-remediation-param-guardrails';

const BINDING = {
  organizationId: 'org_1',
  connectionId: 'conn_gcp',
  checkResultId: 'chk_1',
  remediationKey: 'fix',
};

const COMPUTE_INSTANCE =
  'https://compute.googleapis.com/compute/v1/projects/p/zones/z/instances/i';

describe('effective URL is what executes and what validates', () => {
  it('merges queryParams onto the raw URL', () => {
    expect(
      buildEffectiveGcpStepUrl({
        url: 'https://storage.googleapis.com/storage/v1/b/x',
        queryParams: { updateMask: 'logging' },
      }),
    ).toBe('https://storage.googleapis.com/storage/v1/b/x?updateMask=logging');
  });

  it('sees non-string runtime query values that the annotation cannot rule out', () => {
    const values = stepQueryParamValues(
      {
        url: 'https://storage.googleapis.com/storage/v1/b/x',
        queryParams: { updateMask: ['a', 'b'] },
      },
      'updateMask',
    );
    expect(values).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('refuses never-allow permissions smuggled via queryParams', () => {
    const errors = validateGcpPlanSteps(
      [
        {
          method: 'PATCH',
          url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
          body: { settings: {} },
          queryParams: { filter: 'resourcemanager.projects.delete' },
          purpose: 'fix',
        },
      ],
      { assetClass: 'Data', enforceAllowlist: true },
    );
    expect(errors.join(' ')).toMatch(/never allowed/);
  });

  it('refuses never-allow permissions hidden behind percent-encoding in the URL', () => {
    // WHATWG keeps `%2E` encoded in `search`, so a raw substring match
    // misses it — but the server decodes it to the denied permission.
    const errors = validateGcpPlanSteps(
      [
        {
          method: 'PATCH',
          url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i?filter=resourcemanager%2Eprojects%2Edelete',
          body: { settings: {} },
          purpose: 'fix',
        },
      ],
      { assetClass: 'Data', enforceAllowlist: true },
    );
    expect(errors.join(' ')).toMatch(/never allowed/);
  });

  it('does not flag double-encoded values the server never decodes to denied', () => {
    // One decode mirrors the single server-side decode: `%252E` decodes
    // once to the literal `%2E`, never to the denied permission string.
    const errors = validateGcpPlanSteps(
      [
        {
          method: 'PATCH',
          url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i?filter=resourcemanager%252Eprojects%252Edelete',
          body: { settings: {} },
          purpose: 'fix',
        },
      ],
      { assetClass: 'Data', enforceAllowlist: true },
    );
    expect(errors.join(' ')).not.toMatch(/never allowed/);
  });

  it('exempts bodiless lifecycle POSTs from the body rule (param guard still refuses them)', () => {
    // start/stop take no body by API design. The executor exempts them so
    // the refusal names the lifecycle change, not a missing body.
    const errors = validateGcpPlanSteps([
      {
        method: 'POST',
        url: `${COMPUTE_INSTANCE}/stop`,
        purpose: 'fix',
      },
    ]);
    expect(errors.join(' ')).not.toMatch(/requires a request body/);
  });
});

describe('compute lifecycle and identity actions', () => {
  function compute(url: string, body: Record<string, unknown> = {}) {
    return validateGcpWriteStepParams(
      { method: 'POST', url, body, purpose: 'fix' },
      { index: 0 },
    );
  }

  it.each([
    ['stop'],
    ['start'],
    ['reset'],
    ['setMetadata'],
    ['setTags'],
    ['setCommonInstanceMetadata'],
  ])('refuses compute %s as a fix', (action) => {
    expect(compute(`${COMPUTE_INSTANCE}:${action}`).join(' ')).toMatch(
      /refused for safety/,
    );
  });

  it('refuses project-wide metadata writes (all-instance SSH keys)', () => {
    // setCommonInstanceMetadata does not end with :setMetadata, so it
    // needs its own denylist entry — otherwise project-wide ssh-keys pass
    // while the instance-level equivalent refuses.
    const errors = validateGcpWriteStepParams(
      {
        method: 'POST',
        url: 'https://compute.googleapis.com/compute/v1/projects/p/setCommonInstanceMetadata',
        body: { fingerprint: 'f', items: [{ key: 'ssh-keys', value: 'x' }] },
        purpose: 'fix',
      },
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/setCommonInstanceMetadata/);
  });

  it.each([
    ['metadata', { metadata: { items: [{ key: 'ssh-keys', value: 'x' }] } }],
    ['tags', { tags: { items: ['evil'] } }],
    [
      'serviceAccounts',
      { serviceAccounts: [{ email: 'x@y.iam.gserviceaccount.com' }] },
    ],
    ['networkInterfaces', { networkInterfaces: [{ network: 'x' }] }],
    ['deletionProtection', { deletionProtection: false }],
  ])('refuses direct-field PATCH carrying %s', (_field, body) => {
    // instances.patch honors body fields with no :action suffix — the
    // action denials above are circumventable without this body check.
    const errors = validateGcpWriteStepParams(
      { method: 'PATCH', url: COMPUTE_INSTANCE, body, purpose: 'fix' },
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/refused for safety/);
  });

  it('still allows a PATCH that only enables deletion protection', () => {
    const errors = validateGcpWriteStepParams(
      {
        method: 'PATCH',
        url: COMPUTE_INSTANCE,
        body: { deletionProtection: true },
        purpose: 'fix',
      },
      { index: 0 },
    );
    expect(errors).toEqual([]);
  });

  it.each([
    ['machineType', { machineType: 'n1-standard-1' }],
    [
      'shieldedInstanceConfig',
      { shieldedInstanceConfig: { enableSecureBoot: false } },
    ],
    ['scheduling', { scheduling: { automaticRestart: false } }],
  ])(
    'refuses direct-field PATCH carrying %s (denylist bypass)',
    (_field, body) => {
      // These fields carry the exact changes the `:setMachineType` /
      // `:setShieldedInstanceIntegrityPolicy` action denials block — a field
      // denylist that does not name them lets the change through.
      const errors = validateGcpWriteStepParams(
        { method: 'PATCH', url: COMPUTE_INSTANCE, body, purpose: 'fix' },
        { index: 0 },
      );
      expect(errors.join(' ')).toMatch(/only enabling deletionProtection/);
    },
  );

  it('refuses instance provisioning (POST to the collection)', () => {
    const errors = validateGcpWriteStepParams(
      {
        method: 'POST',
        url: 'https://compute.googleapis.com/compute/v1/projects/p/zones/z/instances',
        body: { name: 'new-vm' },
        purpose: 'fix',
      },
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/provisioning/);
  });

  it('allows enabling deletion protection', () => {
    expect(
      validateGcpComputePatch({
        pathname:
          '/compute/v1/projects/p/zones/z/instances/i/setDeletionProtection',
        method: 'POST',
        body: { deletionProtection: true },
        prefix: 'Step 1',
      }),
    ).toEqual([]);
  });
});

describe('storage object and ACL endpoints', () => {
  it('refuses benign object writes as non-fixes', () => {
    expect(
      validateGcpStorageObjectUrl({
        method: 'PATCH',
        pathname: '/storage/v1/b/my-bucket/o/some-object',
        body: {},
        prefix: 'Step 1',
      }).join(' '),
    ).toMatch(/object-level writes/);
  });

  it('refuses object writes whose object name holds a /b/ segment', () => {
    // Object names may hold slashes: anchoring on the last `b` slices
    // after the inner separator and hides the `/o/` marker.
    expect(
      validateGcpStorageObjectUrl({
        method: 'PATCH',
        pathname: '/storage/v1/b/my-bucket/o/foo/b/bar',
        body: {},
        prefix: 'Step 1',
      }).join(' '),
    ).toMatch(/object-level writes/);
  });

  it('refuses OWNER grants on ACL endpoints', () => {
    const errors = validateGcpWriteStepParams(
      {
        method: 'POST',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/acl',
        body: { entity: 'user:x@example.com', role: 'OWNER' },
        purpose: 'fix',
      },
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/OWNER/);
  });

  it.each([['POST'], ['PATCH']])(
    'refuses public grants via defaultObjectAcl (%s)',
    (method) => {
      // defaultObjectAcl grants default access on every future object —
      // the same exposure as acl under a sibling path, so it faces the
      // same grant checks instead of falling through to no error.
      const errors = validateGcpWriteStepParams(
        {
          method: method,
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/defaultObjectAcl',
          body: { entity: 'allUsers', role: 'READER' },
          purpose: 'fix',
        },
        { index: 0 },
      );
      expect(errors.join(' ')).toMatch(
        /defaultObjectAcl.*public|public.*defaultObjectAcl/,
      );
    },
  );

  it('refuses OWNER grants via defaultObjectAcl entity paths', () => {
    expect(
      validateGcpStorageObjectUrl({
        method: 'PATCH',
        pathname: '/storage/v1/b/my-bucket/defaultObjectAcl/user-x',
        body: { entity: 'user:x@example.com', role: 'OWNER' },
        prefix: 'Step 1',
      }).join(' '),
    ).toMatch(/defaultObjectAcl/);
  });

  it('refuses encoded ACL-endpoint markers that decode on the server', () => {
    // `%6F` is `o`, `%61cl` is `acl`: the server routes the decoded form,
    // so matching raw segments would fall through to allow.
    expect(
      validateGcpStorageObjectUrl({
        method: 'PATCH',
        pathname: '/storage/v1/b/my-bucket/%61cl',
        body: { entity: 'allUsers', role: 'READER' },
        prefix: 'Step 1',
      }).join(' '),
    ).toMatch(/public \(allUsers\)/);
    expect(
      validateGcpStorageObjectUrl({
        method: 'PATCH',
        pathname: '/storage/v1/b/my-bucket/%6F/some-object',
        body: {},
        prefix: 'Step 1',
      }).join(' '),
    ).toMatch(/object-level writes/);
  });

  it('still allows bucket resource PATCH', () => {
    expect(
      validateGcpBucketPatch(
        {
          method: 'PATCH',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
        },
        { iamConfiguration: { uniformBucketLevelAccess: { enabled: true } } },
        'Step 1',
      ),
    ).toEqual([]);
  });

  it('refuses bucket IAM without bindings instead of wiping the policy', () => {
    // `PUT .../b/<bucket>/iam` replaces the whole policy: a body without
    // `bindings` deletes every binding, so absence must refuse rather than
    // skip grant review.
    expect(
      validateGcpBucketPatch(
        {
          method: 'PUT',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/iam',
        },
        { version: 1 },
        'Step 1',
      ).join(' '),
    ).toMatch(/without "bindings"/);
  });

  it('still allows metadata PATCH without bindings on the non-IAM path', () => {
    // The bindings requirement is scoped to the four-segment IAM path —
    // ordinary metadata patches carry no bindings and must keep passing.
    expect(
      validateGcpBucketPatch(
        {
          method: 'PATCH',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
        },
        { labels: { env: 'prod' } },
        'Step 1',
      ),
    ).toEqual([]);
  });

  it('refuses sparse PUT metadata while PATCH with the same body passes', () => {
    // PUT replaces the whole bucket resource: the durability checks read
    // absence as "unchanged", which holds for PATCH merge but silently
    // resets protections under PUT replace.
    expect(
      validateGcpBucketPatch(
        {
          method: 'PUT',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
        },
        { labels: { env: 'prod' } },
        'Step 1',
      ).join(' '),
    ).toMatch(/use PATCH instead/);
  });

  it('still routes IAM PUT past the replace-shaped refusal into grant review', () => {
    // PUT is the documented IAM write shape — it must reach the
    // bindings/etag gates, not the metadata PUT refusal.
    expect(
      validateGcpBucketPatch(
        {
          method: 'PUT',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/iam',
        },
        { bindings: [] },
        'Step 1',
      ).join(' '),
    ).toMatch(/new principal/);
  });

  it('refuses malformed (non-array) bindings instead of reading them as no new grant', () => {
    // GCP would 400 on this shape — but the guardrail must refuse unknown
    // shapes itself rather than pass them through to the wire.
    expect(
      validateGcpBucketPatch(
        {
          method: 'PUT',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/iam',
        },
        { bindings: 'not-an-array' },
        'Step 1',
      ).join(' '),
    ).toMatch(/new principal/);
  });

  it.each([['POST'], ['PUT']])(
    'refuses bucket creation at the collection root (%s)',
    (method) => {
      // A creation body weakens nothing and grants nothing, so every shape
      // check below reads as allow — the collection-root gate must refuse
      // first, or provisioning passes as a fix.
      expect(
        validateGcpBucketPatch(
          {
            method,
            url: 'https://storage.googleapis.com/storage/v1/b/?project=my-proj',
          },
          { name: 'evil-bucket' },
          'Step 1',
        ).join(' '),
      ).toMatch(/creating a bucket/);
    },
  );

  it('refuses creation through the dispatcher, not just the unit', () => {
    const errors = validateGcpWriteStepParams(
      {
        method: 'POST',
        url: 'https://storage.googleapis.com/storage/v1/b/?project=my-proj',
        body: { name: 'evil-bucket' },
        purpose: 'fix',
      },
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/creating a bucket/);
  });

  it('refuses an encoded collection root through the dispatcher', () => {
    // `%2E` is `.`: the normalized pathname is the collection root without
    // a trailing slash — routing must still reach the bucket gate instead
    // of falling through to the generic backstop.
    const errors = validateGcpWriteStepParams(
      {
        method: 'POST',
        url: 'https://storage.googleapis.com/storage/v1/b/%2E?project=my-proj',
        body: { name: 'evil-bucket' },
        purpose: 'fix',
      },
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/creating a bucket/);
  });
});

describe('firewall full port ranges', () => {
  function allowed(ports: unknown) {
    // No `direction` here: changing direction on an update is refused
    // before port checks run, which would mask what these tests assert.
    return validateGcpFirewallPatch(
      {
        sourceRanges: ['10.0.0.0/8'],
        allowed: [{ IPProtocol: 'tcp', ports }],
      },
      'Step 1',
      false,
    );
  }

  it('refuses an exact 0-65535 range', () => {
    expect(allowed(['0-65535']).join(' ')).toMatch(/every port/);
  });

  it('refuses split halves covering every port', () => {
    expect(allowed(['0-32767', '32768-65535']).join(' ')).toMatch(/every port/);
  });

  it('allows a narrow range', () => {
    expect(allowed(['443']).join(' ')).not.toMatch(/every port/);
  });
});

describe('rollback binding is resource-scoped', () => {
  const bucket = 'https://storage.googleapis.com/storage/v1/b/my-bucket';

  it('refuses a write rollback anchored on a GET fix step', () => {
    const errors = validateGcpRollbackOverlap(
      [{ method: 'GET', url: bucket, purpose: 'read' }],
      [
        {
          method: 'PATCH',
          url: bucket,
          queryParams: { updateMask: 'iamConfiguration' },
          purpose: 'rollback',
        },
      ],
    );
    expect(errors.join(' ')).toMatch(/refused for safety/);
  });

  it('returns no policy without a read-step map (no global fallback)', () => {
    expect(
      findPriorPolicyForUrl({ read: { bindings: [] } }, undefined, {
        url: bucket,
      }),
    ).toBeUndefined();
  });

  it('returns no masked value for a fix URL without covering reads', () => {
    expect(
      findPriorStateValue(
        { read: { iamConfiguration: { enabled: true } } },
        'iamConfiguration.enabled',
        { fixStep: { url: bucket } },
      ),
    ).toBeUndefined();
  });

  it('refuses PATCH rollback that cannot bind its fields', () => {
    const errors = validateGcpRollbackSteps(
      [
        {
          method: 'PATCH',
          url: bucket,
          body: { iamConfiguration: {} },
          queryParams: { updateMask: 'iamConfiguration' },
          purpose: 'rollback',
        },
      ],
      {
        fixSteps: [{ method: 'PATCH', url: bucket, purpose: 'fix' }],
        previousState: {
          other: { iamConfiguration: { enabled: true } },
        },
      },
    );
    expect(errors.join(' ')).toMatch(/no pre-fix value to compare/);
  });
});

describe('audit hash and log redaction', () => {
  const base = {
    method: 'PATCH',
    url: 'https://storage.googleapis.com/storage/v1/b/x',
    body: {},
  };

  it('hashes plans apart when only queryParams differ', () => {
    expect(hashGcpPlanSteps([base], [], BINDING)).not.toBe(
      hashGcpPlanSteps(
        [{ ...base, queryParams: { updateMask: 'logging' } }],
        [],
        BINDING,
      ),
    );
  });

  it('strips secrets from unparseable URLs instead of passing them through', () => {
    const redacted = redactGcpUrlForLog('not-a-url?access_token=SECRET');
    expect(redacted).not.toMatch(/SECRET/);
  });

  it('collapses newlines in log purposes (no log forging)', () => {
    expect(sanitizeGcpPurposeForLog('line one\nline two\rline three')).toBe(
      'line one line two line three',
    );
    expect(sanitizeGcpPurposeForLog('x'.repeat(500))).toHaveLength(300);
  });

  it('redacts query strings in allowlist refusal messages', () => {
    const errors = validateGcpPlanSteps(
      [
        {
          method: 'PATCH',
          url: 'https://evil.googleapis.com/v1/x?key=SECRET',
          body: {},
          purpose: 'fix',
        },
      ],
      { assetClass: 'Storage', enforceAllowlist: true },
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).not.toMatch(/SECRET/);
  });
});

describe('review fixes: compute network-attachment and provisioning', () => {
  function compute(url: string, body: Record<string, unknown> = {}) {
    return validateGcpWriteStepParams(
      { method: 'POST', url, body, purpose: 'fix' },
      { index: 0 },
    );
  }

  it.each([['addAccessConfig'], ['updateNetworkInterface'], ['setLabels']])(
    'refuses compute %s as a fix',
    (action) => {
      expect(compute(`${COMPUTE_INSTANCE}:${action}`).join(' ')).toMatch(
        /refused for safety/,
      );
    },
  );

  it('refuses creating any Compute collection, not just instances/disks', () => {
    const errors = validateGcpWriteStepParams(
      {
        method: 'POST',
        url: 'https://compute.googleapis.com/compute/v1/projects/p/global/networks',
        body: { name: 'new-net' },
        purpose: 'fix',
      },
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/provisioning/);
  });
});

describe('review fixes: bucket durability posture', () => {
  const bucket = 'https://storage.googleapis.com/storage/v1/b/my-bucket';

  it('refuses disabling versioning', () => {
    expect(
      validateGcpBucketPatch(
        { method: 'PATCH', url: bucket },
        { versioning: { enabled: false } },
        'Step 1',
      ).join(' '),
    ).toMatch(/versioning/);
  });

  it('refuses clearing the retention policy', () => {
    expect(
      validateGcpBucketPatch(
        { method: 'PATCH', url: bucket },
        { retentionPolicy: null },
        'Step 1',
      ).join(' '),
    ).toMatch(/retention/);
  });

  it('refuses nulling uniform bucket-level access', () => {
    // Explicit null clears the field under PATCH merge semantics — the
    // same removal as `enabled: false` under a narrower spelling.
    expect(
      validateGcpBucketPatch(
        { method: 'PATCH', url: bucket },
        { iamConfiguration: { uniformBucketLevelAccess: null } },
        'Step 1',
      ).join(' '),
    ).toMatch(/uniform bucket-level access/);
  });

  it('refuses nulling the whole iamConfiguration block', () => {
    expect(
      validateGcpBucketPatch(
        { method: 'PATCH', url: bucket },
        { iamConfiguration: null },
        'Step 1',
      ).join(' '),
    ).toMatch(/clearing "iamConfiguration"/);
  });

  it('refuses nulling versioning', () => {
    expect(
      validateGcpBucketPatch(
        { method: 'PATCH', url: bucket },
        { versioning: null },
        'Step 1',
      ).join(' '),
    ).toMatch(/versioning/);
  });

  it('refuses zero retention in any Duration spelling', () => {
    for (const zero of ['0s', '0.0s', '00s', '0.000000000s']) {
      expect(
        validateGcpBucketPatch(
          { method: 'PATCH', url: bucket },
          { retentionPolicy: { retentionPeriod: zero } },
          'Step 1',
        ).join(' '),
      ).toMatch(/retention/);
    }
  });

  it('refuses shortening retention against bound prior state', () => {
    const readUrl = bucket;
    const shortened = validateGcpBucketPatch(
      { method: 'PATCH', url: bucket },
      { retentionPolicy: { retentionPeriod: '1s' } },
      'Step 1',
      {
        read: { retentionPolicy: { retentionPeriod: '315360000s' } },
      },
      { readSteps: [{ purpose: 'read', url: readUrl }] },
    );
    expect(shortened.join(' ')).toMatch(/shortening/);

    const lengthened = validateGcpBucketPatch(
      { method: 'PATCH', url: bucket },
      { retentionPolicy: { retentionPeriod: '630720000s' } },
      'Step 1',
      {
        read: { retentionPolicy: { retentionPeriod: '315360000s' } },
      },
      { readSteps: [{ purpose: 'read', url: readUrl }] },
    );
    expect(lengthened).toEqual([]);
  });

  it('refuses lifecycle edits that can delete objects on a schedule', () => {
    expect(
      validateGcpBucketPatch(
        { method: 'PATCH', url: bucket },
        {
          lifecycle: {
            rule: [{ action: { type: 'Delete' }, condition: { age: 0 } }],
          },
        },
        'Step 1',
      ).join(' '),
    ).toMatch(/lifecycle/);
  });

  it('treats a bucket literally named "acl" as a bucket patch, not an ACL write', () => {
    expect(
      validateGcpStorageObjectUrl({
        method: 'PATCH',
        pathname: '/storage/v1/b/acl',
        body: {},
        prefix: 'Step 1',
      }),
    ).toEqual([]);
  });

  it('refuses DELETE on the bare bucket path', () => {
    // The executor permits DELETE on the rollback path, so a
    // method-blind validator would let a rollback destroy a bucket.
    expect(
      validateGcpStorageObjectUrl({
        method: 'DELETE',
        pathname: '/storage/v1/b/my-bucket',
        body: {},
        prefix: 'Step 1',
      }).join(' '),
    ).toMatch(/deleting a bucket/);
  });

  it('refuses DELETE bucket PATCH', () => {
    expect(
      validateGcpBucketPatch(
        {
          method: 'DELETE',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
        },
        {},
        'Step 1',
      ).join(' '),
    ).toMatch(/deleting a bucket/);
  });

  it('refuses public predefinedDefaultObjectAcl', () => {
    // The future-objects sibling of predefinedAcl grants the same public
    // exposure — scanning only predefinedAcl lets it through.
    const errors = validateGcpWriteStepParams(
      {
        method: 'PATCH',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket?predefinedDefaultObjectAcl=publicRead',
        body: { iamConfiguration: {} },
        purpose: 'fix',
      },
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/canned ACL "publicRead"/);
  });

  it('refuses retention edits without pre-fix read state', () => {
    // Without readable prior state a shortening is unprovable — fail
    // closed instead of weakening blind.
    expect(
      validateGcpBucketPatch(
        {
          method: 'PATCH',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
        },
        { retentionPolicy: { retentionPeriod: '60s' } },
        'Step 1',
      ).join(' '),
    ).toMatch(/without pre-fix read state/);
  });

  it('refuses retention shortening against prior state', () => {
    const readUrl = 'https://storage.googleapis.com/storage/v1/b/my-bucket';
    expect(
      validateGcpBucketPatch(
        { method: 'PATCH', url: readUrl },
        { retentionPolicy: { retentionPeriod: '60s' } },
        'Step 1',
        {
          'read bucket': {
            retentionPolicy: { retentionPeriod: '31536000s' },
          },
        },
        { readSteps: [{ purpose: 'read bucket', url: readUrl }] },
      ).join(' '),
    ).toMatch(/shortening the bucket retention period/);
  });

  it('allows retention lengthening against prior state', () => {
    const readUrl = 'https://storage.googleapis.com/storage/v1/b/my-bucket';
    expect(
      validateGcpBucketPatch(
        { method: 'PATCH', url: readUrl },
        { retentionPolicy: { retentionPeriod: '63072000s' } },
        'Step 1',
        {
          'read bucket': {
            retentionPolicy: { retentionPeriod: '31536000s' },
          },
        },
        { readSteps: [{ purpose: 'read bucket', url: readUrl }] },
      ),
    ).toEqual([]);
  });

  it('refuses a Compute action smuggled behind a protection body', () => {
    // `:updateShieldedInstanceConfig` is not denylisted, and the body
    // carries only deletionProtection — the old field gate read it as
    // hardening while the server routes the dangerous action.
    expect(
      validateGcpComputePatch({
        pathname:
          '/compute/v1/projects/p/zones/z/instances/i:updateShieldedInstanceConfig',
        method: 'POST',
        body: { deletionProtection: true },
        prefix: 'Step 1',
      }).join(' '),
    ).toMatch(/only enabling deletionProtection/);
  });
});

describe('review fixes: nested privilege grants', () => {
  it('refuses roles/owner nested under policy on a non-setIamPolicy URL', () => {
    const errors = validateGcpWriteStepParams(
      {
        method: 'PATCH',
        url: 'https://pubsub.googleapis.com/v1/projects/p/topics/t',
        body: {
          policy: {
            bindings: [
              { role: 'roles/owner', members: ['user:x@example.com'] },
            ],
          },
        },
        purpose: 'fix',
      },
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/privileged role/);
  });

  it('refuses cased and padded privileged roles the same way', () => {
    // A case or whitespace game must not decide what a grant means.
    for (const role of [
      'Roles/Owner',
      '  roles/editor  ',
      'ROLES/RESOURCEMANAGER.ORGANIZATIONADMIN',
    ]) {
      const errors = validateGcpWriteStepParams(
        {
          method: 'PATCH',
          url: 'https://pubsub.googleapis.com/v1/projects/p/topics/t',
          body: {
            policy: {
              bindings: [{ role, members: ['user:x@example.com'] }],
            },
          },
          purpose: 'fix',
        },
        { index: 0 },
      );
      expect(errors.join(' ')).toMatch(/privileged role/);
    }
  });

  it('refuses public grants nested under iamPolicy', () => {
    const errors = validateGcpWriteStepParams(
      {
        method: 'PATCH',
        url: 'https://pubsub.googleapis.com/v1/projects/p/topics/t',
        body: {
          iamPolicy: {
            bindings: [{ role: 'roles/viewer', members: ['allUsers'] }],
          },
        },
        purpose: 'fix',
      },
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/public/);
  });
});

describe('review fixes: rollback overlap resolves dot segments', () => {
  const bucket = 'https://storage.googleapis.com/storage/v1/b/good-bucket';

  it('refuses a rollback that escapes via .. to a sibling', () => {
    const errors = validateGcpRollbackOverlap(
      [{ method: 'PATCH', url: bucket, purpose: 'fix' }],
      [
        {
          method: 'PATCH',
          url: 'https://storage.googleapis.com/storage/v1/b/good-bucket/../other-bucket',
          queryParams: { updateMask: 'iamConfiguration' },
          purpose: 'rollback',
        },
      ],
    );
    expect(errors.join(' ')).toMatch(/refused for safety/);
  });
});

describe('review fixes: unprovable retention shortening', () => {
  const bucket = 'https://storage.googleapis.com/storage/v1/b/my-bucket';
  const shorten = { retentionPolicy: { retentionPeriod: '1s' } };
  const step = { method: 'PATCH' as const, url: bucket };

  it('refuses shortening when prior state binds to another resource', () => {
    // Real state is non-empty, but no bound retention record exists: the
    // old comparison passed by default and silently removed deletion
    // protection.
    const errors = validateGcpBucketPatch(
      step,
      shorten,
      'Step 1',
      {
        unrelated: { name: 'other-bucket' },
      },
      {
        readSteps: [
          {
            purpose: 'unrelated',
            url: 'https://storage.googleapis.com/storage/v1/b/other-bucket',
          },
        ],
      },
    );
    expect(errors.join(' ')).toMatch(/cannot prove/);
  });

  it('allows adding a policy the bound read proves absent', () => {
    // The covering read returned the bucket without any retentionPolicy:
    // setting one adds deletion protection instead of weakening it.
    expect(
      validateGcpBucketPatch(
        step,
        { retentionPolicy: { retentionPeriod: '315360000s' } },
        'Step 1',
        { read: { name: 'my-bucket' } },
        { readSteps: [{ purpose: 'read', url: bucket }] },
      ),
    ).toEqual([]);
  });

  it('refuses when the covering read selects a field subset', () => {
    // `?fields=name` omits the policy even when the bucket has one — "no
    // key" proves nothing, so the shortening stays unprovable.
    const errors = validateGcpBucketPatch(
      step,
      shorten,
      'Step 1',
      {
        read: { name: 'my-bucket' },
      },
      {
        readSteps: [{ purpose: 'read', url: `${bucket}?fields=name` }],
      },
    );
    expect(errors.join(' ')).toMatch(/cannot prove/);
  });

  it('refuses when several reads cover the fix target', () => {
    // Two covering records could belong to different resources — binding
    // either one would ground the comparison on the wrong bucket.
    const errors = validateGcpBucketPatch(
      step,
      shorten,
      'Step 1',
      {
        first: { name: 'my-bucket' },
        second: { name: 'my-bucket' },
      },
      {
        readSteps: [
          { purpose: 'first', url: bucket },
          { purpose: 'second', url: bucket },
        ],
      },
    );
    expect(errors.join(' ')).toMatch(/cannot prove/);
  });
});
