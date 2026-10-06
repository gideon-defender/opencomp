import {
  validateGcpRollbackOverlap,
  validateGcpRollbackSteps,
} from './gcp-remediation-rollback-validators';
import { appliedFixStepsForOverlap } from './gcp-remediation-plan.utils';

const FIX = {
  method: 'PATCH',
  url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
  body: { iamConfiguration: {} },
  purpose: 'fix',
};

describe('validateGcpRollbackSteps', () => {
  it('refuses IAM rollback without verbatim prior policy', () => {
    const errors = validateGcpRollbackSteps(
      [
        {
          method: 'POST',
          url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p:setIamPolicy',
          body: { policy: { bindings: [] } },
          purpose: 'rollback',
        },
      ],
      {},
    );
    expect(errors.join(' ')).toMatch(/full prior bindings array/);
    expect(errors.join(' ')).toMatch(/prior etag/);
    expect(errors.join(' ')).toMatch(/prior policy version/);
  });

  it('refuses PATCH rollback without updateMask', () => {
    const errors = validateGcpRollbackSteps(
      [
        {
          method: 'PATCH',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
          body: { iamConfiguration: {} },
          purpose: 'rollback',
        },
      ],
      {},
    );
    expect(errors.join(' ')).toMatch(/updateMask/);
  });

  it('refuses PUT rollback without updateMask', () => {
    const errors = validateGcpRollbackSteps(
      [
        {
          method: 'PUT',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
          body: { iamConfiguration: {} },
          purpose: 'rollback',
        },
      ],
      {},
    );
    expect(errors.join(' ')).toMatch(/updateMask/);
  });

  it('accepts a well-formed rollback', () => {
    expect(
      validateGcpRollbackSteps(
        [
          {
            method: 'PATCH',
            url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
            body: { iamConfiguration: {} },
            queryParams: { updateMask: 'iamConfiguration' },
            purpose: 'rollback',
          },
        ],
        {
          fixSteps: [FIX],
          previousState: { read: { iamConfiguration: {} } },
          readSteps: [
            {
              purpose: 'read',
              url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
            },
          ],
          expectedBucket: 'my-bucket',
        },
      ),
    ).toEqual([]);
  });

  it('accepts a PUT rollback with updateMask', () => {
    expect(
      validateGcpRollbackSteps(
        [
          {
            method: 'PUT',
            url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
            body: { iamConfiguration: {} },
            queryParams: { updateMask: 'iamConfiguration' },
            purpose: 'rollback',
          },
        ],
        {
          fixSteps: [FIX],
          previousState: { read: { iamConfiguration: {} } },
          readSteps: [
            {
              purpose: 'read',
              url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
            },
          ],
          expectedBucket: 'my-bucket',
        },
      ),
    ).toEqual([]);
  });

  it('refuses a PATCH rollback with no pre-fix state to compare', () => {
    // A masked write with nothing to compare against is a well-formed but
    // fabricated restore — fail closed like the IAM path does.
    for (const previousState of [undefined, {}]) {
      const errors = validateGcpRollbackSteps(
        [
          {
            method: 'PATCH',
            url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
            body: { iamConfiguration: {} },
            queryParams: { updateMask: 'iamConfiguration' },
            purpose: 'rollback',
          },
        ],
        {
          fixSteps: [FIX],
          ...(previousState ? { previousState } : {}),
        },
      );
      expect(errors.join(' ')).toMatch(/no pre-fix state to compare/);
    }
  });

  it('refuses a cross-project rollback step', () => {
    const errors = validateGcpRollbackSteps(
      [
        {
          method: 'PATCH',
          url: 'https://compute.googleapis.com/compute/v1/projects/other/global/firewalls/f',
          body: {},
          queryParams: { updateMask: 'allowed' },
          purpose: 'rollback',
        },
      ],
      {
        fixSteps: [
          {
            method: 'PATCH',
            url: 'https://compute.googleapis.com/compute/v1/projects/other/global/firewalls/f',
            body: {},
            purpose: 'fix',
          },
        ],
        expectedProjectId: 'mine',
      },
    );
    expect(errors.join(' ')).toMatch(/different project|targets project/);
  });

  it('refuses a rollback POST that widens the firewall', () => {
    // Rollbacks face the same dual-use parameter gates as fixes: a
    // rollback that opens sourceRanges is an unreviewed write.
    const errors = validateGcpRollbackSteps(
      [
        {
          method: 'POST',
          url: 'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls',
          body: { sourceRanges: ['0.0.0.0/0'] },
          purpose: 'rollback',
        },
      ],
      {
        fixSteps: [
          {
            method: 'POST',
            url: 'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls',
            body: {},
            purpose: 'fix',
          },
        ],
      },
    );
    expect(errors.join(' ')).toMatch(/widens the firewall/);
  });

  it('refuses a rollback that grants bucket bindings to the public', () => {
    const errors = validateGcpRollbackSteps(
      [
        {
          method: 'PUT',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/iam',
          body: {
            bindings: [
              { role: 'roles/storage.objectViewer', members: ['allUsers'] },
            ],
          },
          queryParams: { updateMask: 'bindings' },
          purpose: 'rollback',
        },
      ],
      { fixSteps: [FIX] },
    );
    expect(errors.join(' ')).toMatch(/"bindings" to the public/);
  });
});

describe('validateGcpRollbackOverlap', () => {
  it('refuses rollbacks outside every fixed resource', () => {
    const errors = validateGcpRollbackOverlap(
      [FIX],
      [
        {
          method: 'PATCH',
          url: 'https://storage.googleapis.com/storage/v1/b/other-bucket',
          body: {},
          purpose: 'rollback',
        },
      ],
    );
    expect(errors.join(' ')).toMatch(/does not target fix step/);
  });

  it('allows rollbacks under a fixed resource directory', () => {
    expect(
      validateGcpRollbackOverlap(
        [FIX],
        [
          {
            method: 'POST',
            url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/iam',
            body: {},
            purpose: 'rollback',
          },
        ],
      ),
    ).toEqual([]);
  });

  it('refuses DELETE of the exact PATCH-fixed resource', () => {
    // Deleting a resource the fix merely patched destroys it instead of
    // restoring it — DELETE is only sound for something the fix created.
    const errors = validateGcpRollbackOverlap(
      [FIX],
      [{ method: 'DELETE', url: FIX.url, purpose: 'rollback' }],
    );
    expect(errors.join(' ')).toMatch(/does not target fix step/);
  });

  it('allows DELETE of the exact POST-created resource', () => {
    const created = { ...FIX, method: 'POST' };
    expect(
      validateGcpRollbackOverlap(
        [created],
        [{ method: 'DELETE', url: FIX.url, purpose: 'rollback' }],
      ),
    ).toEqual([]);
  });

  it('refuses DELETE of the exact PUT-updated resource', () => {
    // A PUT fix may have updated a pre-existing resource instead of
    // creating it — an exact DELETE then destroys rather than restores.
    // Only POST provably creates the exact resource being deleted.
    const updated = { ...FIX, method: 'PUT' };
    const errors = validateGcpRollbackOverlap(
      [updated],
      [{ method: 'DELETE', url: FIX.url, purpose: 'rollback' }],
    );
    expect(errors.join(' ')).toMatch(/does not target fix step/);
  });

  it('refuses a GET rollback step — a read restores nothing', () => {
    const errors = validateGcpRollbackOverlap(
      [FIX],
      [{ method: 'GET', url: FIX.url, purpose: 'rollback' }],
    );
    expect(errors.join(' ')).toMatch(/restores nothing/);
  });

  it('refuses below-fix DELETE authorized only by a free-text mention', () => {
    // The child name appears in the fix body, but only inside
    // `description` — a mention, not a creation. The rollback would delete
    // a pre-existing sibling the fix never wrote.
    const fix = {
      method: 'POST',
      url: 'https://storage.googleapis.com/storage/v1/b?project=p',
      body: { description: 'photos-archive' },
      purpose: 'fix',
    };
    const errors = validateGcpRollbackOverlap(
      [fix],
      [
        {
          method: 'DELETE',
          url: 'https://storage.googleapis.com/storage/v1/b/photos-archive',
          purpose: 'rollback',
        },
      ],
    );
    expect(errors.join(' ')).toMatch(/refused for safety/);
  });

  it('refuses below-fix DELETE authorized only by an object key', () => {
    // Field names never name the created child — only values do.
    const fix = {
      method: 'POST',
      url: 'https://storage.googleapis.com/storage/v1/b?project=p',
      body: { 'photos-archive': true },
      purpose: 'fix',
    };
    const errors = validateGcpRollbackOverlap(
      [fix],
      [
        {
          method: 'DELETE',
          url: 'https://storage.googleapis.com/storage/v1/b/photos-archive',
          purpose: 'rollback',
        },
      ],
    );
    expect(errors.join(' ')).toMatch(/refused for safety/);
  });

  it('allows below-fix DELETE naming the created child value', () => {
    const fix = {
      method: 'POST',
      url: 'https://storage.googleapis.com/storage/v1/b?project=p',
      body: { name: 'new-bucket' },
      purpose: 'fix',
    };
    expect(
      validateGcpRollbackOverlap(
        [fix],
        [
          {
            method: 'DELETE',
            url: 'https://storage.googleapis.com/storage/v1/b/new-bucket',
            purpose: 'rollback',
          },
        ],
      ),
    ).toEqual([]);
  });

  it('refuses below-fix DELETE matching only a label or metadata value', () => {
    // The sibling name coincides with a label value in the fix body — a
    // mention, not a creation. Only identity fields may authorize a DELETE.
    const fix = {
      method: 'POST',
      url: 'https://storage.googleapis.com/storage/v1/b?project=p',
      body: { name: 'new-bucket', labels: { team: 'photos-archive' } },
      purpose: 'fix',
    };
    const errors = validateGcpRollbackOverlap(
      [fix],
      [
        {
          method: 'DELETE',
          url: 'https://storage.googleapis.com/storage/v1/b/photos-archive',
          purpose: 'rollback',
        },
      ],
    );
    expect(errors.join(' ')).toMatch(
      /refused for safety|does not target fix step/,
    );
  });

  it('allows below-fix DELETE naming the child via an Id reference', () => {
    // Created children can arrive nested in reference objects
    // (`datasetReference.datasetId`) rather than a top-level `name`.
    const fix = {
      method: 'POST',
      url: 'https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets',
      body: { datasetReference: { datasetId: 'new_dataset' } },
      purpose: 'fix',
    };
    expect(
      validateGcpRollbackOverlap(
        [fix],
        [
          {
            method: 'DELETE',
            url: 'https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets/new_dataset',
            purpose: 'rollback',
          },
        ],
      ),
    ).toEqual([]);
  });

  it('distinguishes SQL users selected by ?name=', () => {
    // User identity lives in the query string: comparing raw URLs
    // conflates ?name=alice with ?name=bob and binds the wrong rollback.
    const fix = {
      method: 'PUT',
      url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i/users?name=alice',
      body: {},
      purpose: 'fix',
    };
    const rollbackSameUser = {
      method: 'PUT',
      url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i/users?name=alice',
      queryParams: { updateMask: 'password' },
      body: {},
      purpose: 'rollback',
    };
    expect(validateGcpRollbackOverlap([fix], [rollbackSameUser])).toEqual([]);
    const rollbackOtherUser = {
      method: 'PUT',
      url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i/users?name=bob',
      queryParams: { updateMask: 'password' },
      body: {},
      purpose: 'rollback',
    };
    expect(
      validateGcpRollbackOverlap([fix], [rollbackOtherUser]).join(' '),
    ).toMatch(/does not target fix step/);
  });

  it('binds reconstructed fix steps by persisted query identity', () => {
    // Executed steps persist redacted (queryless) command strings: overlap
    // must bind through the persisted `queryIdentity`, not the raw query.
    const reconstructed = appliedFixStepsForOverlap({
      steps: [
        {
          command:
            'PUT https://sqladmin.googleapis.com/v1/projects/p/instances/i/users',
          purpose: 'fix',
          queryIdentity: ['alice'],
        },
      ],
    });
    const rollbackSameUser = {
      method: 'PUT',
      url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i/users?name=alice',
      queryParams: { updateMask: 'password' },
      body: {},
      purpose: 'rollback',
    };
    expect(
      validateGcpRollbackOverlap(reconstructed, [rollbackSameUser]),
    ).toEqual([]);
    const rollbackOtherUser = {
      ...rollbackSameUser,
      url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i/users?name=bob',
    };
    expect(
      validateGcpRollbackOverlap(reconstructed, [rollbackOtherUser]).join(' '),
    ).toMatch(/does not target fix step/);
  });

  it('refuses DELETE of a sibling resource', () => {
    const errors = validateGcpRollbackOverlap(
      [FIX],
      [
        {
          method: 'DELETE',
          url: 'https://storage.googleapis.com/storage/v1/b/other-bucket',
          purpose: 'rollback',
        },
      ],
    );
    expect(errors.join(' ')).toMatch(/does not target fix step/);
  });

  it('allows DELETE below a POST-created resource', () => {
    const create = {
      method: 'POST',
      url: 'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls',
      body: { name: 'fw-1' },
      purpose: 'fix',
    };
    expect(
      validateGcpRollbackOverlap(
        [create],
        [
          {
            method: 'DELETE',
            url: 'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls/fw-1',
            purpose: 'rollback',
          },
        ],
      ),
    ).toEqual([]);
  });

  it('refuses DELETE of a sibling below a POST-created collection', () => {
    // A POST to a collection creates the child named in its body — a
    // DELETE of any other child destroys a pre-existing sibling the fix
    // never wrote, even though it sits below the fix resource.
    const create = {
      method: 'POST',
      url: 'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls',
      body: { name: 'fw-1' },
      purpose: 'fix',
    };
    const errors = validateGcpRollbackOverlap(
      [create],
      [
        {
          method: 'DELETE',
          url: 'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls/victim',
          purpose: 'rollback',
        },
      ],
    );
    expect(errors.join(' ')).toMatch(/does not target fix step/);
  });

  it('refuses DELETE below a POST fix whose body names no child', () => {
    const create = {
      method: 'POST',
      url: 'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls',
      body: {},
      purpose: 'fix',
    };
    const errors = validateGcpRollbackOverlap(
      [create],
      [
        {
          method: 'DELETE',
          url: 'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls/fw-1',
          purpose: 'rollback',
        },
      ],
    );
    expect(errors.join(' ')).toMatch(/does not target fix step/);
  });

  it('refuses DELETE below a PATCH-fixed resource', () => {
    const errors = validateGcpRollbackOverlap(
      [FIX],
      [
        {
          method: 'DELETE',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/o/obj',
          purpose: 'rollback',
        },
      ],
    );
    expect(errors.join(' ')).toMatch(/does not target fix step/);
  });

  it('refuses reordered rollbacks when lengths match the fixes', () => {
    // The executor compensates by position (rollback[j] undoes fix step
    // j) — an order-free overlap would pass a swapped rollback that then
    // undoes the wrong step on partial failure.
    const fixA = {
      method: 'PATCH',
      url: 'https://storage.googleapis.com/storage/v1/b/bucket-a',
      body: {},
      purpose: 'fix',
    };
    const fixB = {
      method: 'PATCH',
      url: 'https://storage.googleapis.com/storage/v1/b/bucket-b',
      body: {},
      purpose: 'fix',
    };
    const rollbackA = {
      method: 'PATCH' as const,
      url: 'https://storage.googleapis.com/storage/v1/b/bucket-a',
      body: {},
      queryParams: { updateMask: 'iamConfiguration' },
      purpose: 'rollback',
    };
    const rollbackB = {
      method: 'PATCH' as const,
      url: 'https://storage.googleapis.com/storage/v1/b/bucket-b',
      body: {},
      queryParams: { updateMask: 'iamConfiguration' },
      purpose: 'rollback',
    };
    expect(
      validateGcpRollbackOverlap([fixA, fixB], [rollbackA, rollbackB]),
    ).toEqual([]);
    const errors = validateGcpRollbackOverlap(
      [fixA, fixB],
      [rollbackB, rollbackA],
    );
    expect(errors.join(' ')).toMatch(/does not target fix step/);
  });
});

const IAM_ROLLBACK_URL =
  'https://cloudresourcemanager.googleapis.com/v3/projects/p:setIamPolicy';
const PRIOR_STATE = {
  read: {
    bindings: [{ role: 'roles/viewer', members: ['alice@example.com'] }],
    etag: 'e1',
    version: 1,
  },
};

function iamRollback(policy: Record<string, unknown>) {
  return {
    method: 'POST',
    url: IAM_ROLLBACK_URL,
    body: { policy },
    purpose: 'rollback',
  };
}

describe('validateGcpRollbackSteps prior-state equality', () => {
  const iamReadSteps = [
    {
      purpose: 'read',
      url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p:getIamPolicy',
    },
  ];

  it('accepts a verbatim IAM rollback against the pre-fix policy', () => {
    expect(
      validateGcpRollbackSteps([iamRollback({ ...PRIOR_STATE.read })], {
        fixSteps: [iamRollback({ ...PRIOR_STATE.read })],
        previousState: PRIOR_STATE,
        readSteps: iamReadSteps,
        expectedProjectId: 'p',
      }),
    ).toEqual([]);
  });

  it('refuses a well-formed but fabricated IAM rollback', () => {
    const errors = validateGcpRollbackSteps(
      [
        iamRollback({
          bindings: [
            { role: 'roles/editor', members: ['mallory@evil.example'] },
          ],
          etag: 'e1',
          version: 1,
        }),
      ],
      {
        fixSteps: [iamRollback({ ...PRIOR_STATE.read })],
        previousState: PRIOR_STATE,
        readSteps: iamReadSteps,
      },
    );
    expect(errors.join(' ')).toMatch(/differ from the pre-fix policy/);
  });

  it('refuses without state (no pre-fix policy to compare)', () => {
    // No pre-fix state means no equality proof: a whole-policy replace
    // DELETES everything not included, so shape alone cannot approve it.
    const errors = validateGcpRollbackSteps(
      [iamRollback({ ...PRIOR_STATE.read })],
      {},
    );
    expect(errors.join(' ')).toMatch(/no pre-fix policy to compare/);
  });

  it('refuses a PATCH rollback whose values differ from pre-fix state', () => {
    const errors = validateGcpRollbackSteps(
      [
        {
          method: 'PATCH',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
          body: {
            iamConfiguration: {
              uniformBucketLevelAccess: { enabled: false },
            },
          },
          queryParams: { updateMask: 'iamConfiguration' },
          purpose: 'rollback',
        },
      ],
      {
        fixSteps: [FIX],
        previousState: {
          read: {
            iamConfiguration: {
              uniformBucketLevelAccess: { enabled: true },
            },
          },
        },
        readSteps: [
          {
            purpose: 'read',
            url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
          },
        ],
      },
    );
    expect(errors.join(' ')).toMatch(/does not restore the pre-fix value/);
  });

  it('accepts updateMask carried in the raw step URL', () => {
    expect(
      validateGcpRollbackSteps(
        [
          {
            method: 'PATCH',
            url: 'https://storage.googleapis.com/storage/v1/b/my-bucket?updateMask=iamConfiguration',
            body: { iamConfiguration: {} },
            purpose: 'rollback',
          },
        ],
        {
          fixSteps: [FIX],
          previousState: { read: { iamConfiguration: {} } },
          readSteps: [
            {
              purpose: 'read',
              url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
            },
          ],
          expectedBucket: 'my-bucket',
        },
      ),
    ).toEqual([]);
  });
});

describe('validateGcpRollbackSteps POST replay', () => {
  const POST_FIX = {
    method: 'POST',
    url: 'https://pubsub.googleapis.com/v1/projects/p/topics/t',
    body: { labels: { env: 'prod' } },
    purpose: 'fix',
  };
  const STATE = { read: { labels: { env: 'prod' } } };

  it('refuses POST rollback without pre-fix state to compare', () => {
    // Overlap plus generic gates cannot prove a restore — same bar as the
    // IAM and PATCH paths.
    const errors = validateGcpRollbackSteps(
      [{ ...POST_FIX, purpose: 'rollback' }],
      { fixSteps: [POST_FIX] },
    );
    expect(errors.join(' ')).toMatch(/no pre-fix state to compare/);
  });

  it('accepts POST rollback replaying the reviewed fix body', () => {
    expect(
      validateGcpRollbackSteps([{ ...POST_FIX, purpose: 'rollback' }], {
        fixSteps: [POST_FIX],
        previousState: STATE,
        expectedProjectId: 'p',
      }),
    ).toEqual([]);
  });

  it('refuses POST rollback with a novel body (third state)', () => {
    const errors = validateGcpRollbackSteps(
      [
        {
          ...POST_FIX,
          body: { labels: { env: 'evil' } },
          purpose: 'rollback',
        },
      ],
      { fixSteps: [POST_FIX], previousState: STATE },
    );
    expect(errors.join(' ')).toMatch(/differs from the reviewed fix write/);
  });

  it('allows POST rollback when fix steps carry no bodies (manual path)', () => {
    // Fix steps reconstructed from applied-state command strings have
    // method+URL only — with no reviewed body to compare, state presence
    // plus the parameter gates is the check.
    expect(
      validateGcpRollbackSteps([{ ...POST_FIX, purpose: 'rollback' }], {
        fixSteps: [{ method: 'POST', url: POST_FIX.url, purpose: 'fix' }],
        previousState: STATE,
        expectedProjectId: 'p',
      }),
    ).toEqual([]);
  });

  it('refuses POST rollback to a resource no fix step touched', () => {
    // Same body as the reviewed fix, but a novel URL: overlap proves
    // *where*, so a non-overlapping target is a fresh unreviewed write.
    // Two fix steps force the non-positional path.
    const errors = validateGcpRollbackSteps(
      [
        {
          ...POST_FIX,
          url: 'https://storage.googleapis.com/storage/v1/b/other-bucket',
          purpose: 'rollback',
        },
      ],
      {
        fixSteps: [
          POST_FIX,
          { method: 'PATCH', url: POST_FIX.url, purpose: 'fix' },
        ],
        previousState: STATE,
      },
    );
    expect(errors.join(' ')).toMatch(/no reviewed fix step touched/);
  });

  it('refuses positional POST rollback replayed against the wrong URL', () => {
    // Lengths match (positional mode), but the rollback body lands on a
    // resource the paired fix never wrote — the index is not trusted.
    const errors = validateGcpRollbackSteps(
      [
        {
          ...POST_FIX,
          url: 'https://storage.googleapis.com/storage/v1/b/other-bucket',
          purpose: 'rollback',
        },
      ],
      {
        fixSteps: [{ method: 'POST', url: POST_FIX.url, purpose: 'fix' }],
        previousState: STATE,
      },
    );
    expect(errors.join(' ')).toMatch(/no reviewed fix step touched/);
  });

  it('refuses POST rollback with no reviewed fix steps at all', () => {
    const errors = validateGcpRollbackSteps(
      [{ ...POST_FIX, purpose: 'rollback' }],
      { fixSteps: [], previousState: STATE },
    );
    expect(errors.join(' ')).toMatch(/no reviewed fix steps to replay/);
  });
});

describe('validateGcpRollbackSteps IAM auditConfigs verbatim', () => {
  const iamReadSteps = [
    {
      purpose: 'read',
      url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p:getIamPolicy',
    },
  ];
  const priorWithAudit = {
    read: {
      ...PRIOR_STATE.read,
      auditConfigs: [
        {
          service: 'allServices',
          auditLogConfigs: [{ logType: 'ADMIN_READ' }],
        },
      ],
    },
  };

  it('refuses a rollback that drops auditConfigs present pre-fix', () => {
    const errors = validateGcpRollbackSteps(
      [iamRollback({ ...PRIOR_STATE.read })],
      {
        fixSteps: [iamRollback({ ...PRIOR_STATE.read })],
        previousState: priorWithAudit,
        readSteps: iamReadSteps,
      },
    );
    expect(errors.join(' ')).toMatch(
      /auditConfigs differ from the pre-fix policy/,
    );
  });

  it('refuses a rollback that rewrites auditConfigs', () => {
    const errors = validateGcpRollbackSteps(
      [
        iamRollback({
          ...PRIOR_STATE.read,
          auditConfigs: [
            {
              service: 'allServices',
              auditLogConfigs: [
                {
                  logType: 'ADMIN_READ',
                  exemptedMembers: ['mallory@evil.example'],
                },
              ],
            },
          ],
        }),
      ],
      {
        fixSteps: [iamRollback({ ...PRIOR_STATE.read })],
        previousState: priorWithAudit,
        readSteps: iamReadSteps,
      },
    );
    expect(errors.join(' ')).toMatch(
      /auditConfigs differ from the pre-fix policy/,
    );
  });

  it('refuses a rollback that fabricates auditConfigs absent pre-fix', () => {
    const errors = validateGcpRollbackSteps(
      [
        iamRollback({
          ...PRIOR_STATE.read,
          auditConfigs: [{ service: 'allServices', auditLogConfigs: [] }],
        }),
      ],
      {
        fixSteps: [iamRollback({ ...PRIOR_STATE.read })],
        previousState: PRIOR_STATE,
        readSteps: iamReadSteps,
      },
    );
    expect(errors.join(' ')).toMatch(
      /auditConfigs differ from the pre-fix policy/,
    );
  });

  it('accepts a verbatim rollback that keeps auditConfigs', () => {
    expect(
      validateGcpRollbackSteps([iamRollback({ ...priorWithAudit.read })], {
        fixSteps: [iamRollback({ ...priorWithAudit.read })],
        previousState: priorWithAudit,
        readSteps: iamReadSteps,
        expectedProjectId: 'p',
      }),
    ).toEqual([]);
  });
});
