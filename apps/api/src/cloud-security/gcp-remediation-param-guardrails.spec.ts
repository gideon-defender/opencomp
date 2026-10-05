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

describe('validateGcpWriteStepParams', () => {
  it('skips reads (GET) entirely', () => {
    expect(
      validateGcpWriteStepParams(
        step({ method: 'GET', url: 'https://storage.googleapis.com/x' }),
        { index: 0 },
      ),
    ).toEqual([]);
  });

  it('refuses firewall widening but allows narrowing', () => {
    const firewallUrl =
      'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls/f';
    const widen = validateGcpWriteStepParams(
      step({
        url: firewallUrl,
        body: { sourceRanges: ['10.0.0.0/8', '0.0.0.0/0'] },
      }),
      { index: 0 },
    );
    expect(widen.join(' ')).toMatch(/widens the firewall/);

    // A merge that omits `allowed` keeps the stored list: narrowing now
    // requires read state proving the stored list is narrow too.
    const narrow = validateGcpWriteStepParams(
      step({
        url: firewallUrl,
        body: { sourceRanges: ['10.0.0.0/8'] },
      }),
      {
        realState: {
          read: { allowed: [{ IPProtocol: 'tcp', ports: ['443'] }] },
        },
        readSteps: [{ url: firewallUrl, purpose: 'read' }],
        index: 0,
      },
    );
    expect(narrow).toEqual([]);

    const unproven = validateGcpWriteStepParams(
      step({
        url: firewallUrl,
        body: { sourceRanges: ['10.0.0.0/8'] },
      }),
      { index: 0 },
    );
    expect(unproven.join(' ')).toMatch(/leaves the stored list unproven/);
  });

  it('refuses setIamPolicy that drops bindings present in read state', () => {
    const realState = {
      read: {
        bindings: [{ role: 'roles/viewer', members: ['a'] }],
        etag: 'abc',
        version: 3,
      },
    };
    const errors = validateGcpWriteStepParams(
      step({
        method: 'POST',
        url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p:setIamPolicy',
        body: { policy: { bindings: [], etag: 'abc', version: 3 } },
      }),
      {
        realState,
        readSteps: [
          {
            purpose: 'read',
            url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p:getIamPolicy',
          },
        ],
        index: 2,
      },
    );
    expect(errors.join(' ')).toMatch(/drops "bindings"/);
    expect(errors[0] ?? '').toMatch(/^Step 3 \(POST /);
  });

  it('refuses setIamPolicy without read state even with a full shape', () => {
    const errors = validateGcpWriteStepParams(
      step({
        method: 'POST',
        url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p:setIamPolicy',
        body: {
          policy: {
            bindings: [{ role: 'roles/viewer', members: ['a'] }],
            etag: 'abc',
            version: 3,
          },
        },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/without read state/);
  });

  it('refuses public-IP removal without a private IP in read state', () => {
    const errors = validateGcpWriteStepParams(
      step({
        url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
        body: { settings: { ipConfiguration: { ipv4Enabled: false } } },
      }),
      {
        realState: {
          read: { settings: { ipAddresses: [{ type: 'PRIMARY' }] } },
        },
        index: 0,
      },
    );
    expect(errors.join(' ')).toMatch(/breaks connectivity/);
  });

  it('refuses databaseFlags that drop pre-existing flags', () => {
    const errors = validateGcpWriteStepParams(
      step({
        url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
        body: {
          settings: { databaseFlags: [{ name: 'new_flag', value: 'on' }] },
        },
      }),
      {
        realState: {
          read: {
            settings: { databaseFlags: [{ name: 'old_flag', value: 'on' }] },
          },
        },
        readSteps: [
          {
            url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
            purpose: 'read',
          },
        ],
        index: 0,
      },
    );
    expect(errors.join(' ')).toMatch(/drops pre-existing flag "old_flag"/);
  });

  it('refuses flag edits without read state outright', () => {
    const errors = validateGcpWriteStepParams(
      step({
        url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
        body: {
          settings: { databaseFlags: [{ name: 'new_flag', value: 'on' }] },
        },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/without bound read state/);
  });

  it('refuses nulling the whole databaseFlags list', () => {
    // Explicit null clears every flag at once under PATCH merge semantics —
    // the wholesale version of every per-flag drop the validator refuses.
    const errors = validateGcpWriteStepParams(
      step({
        url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
        body: { settings: { databaseFlags: null } },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/clearing "databaseFlags"/);
  });

  it('refuses SQL export and user-insert shapes before parameter checks', () => {
    const exportErrors = validateGcpWriteStepParams(
      step({
        method: 'POST',
        url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i/export',
        body: { exportContext: { uri: 'gs://attacker-bucket/dump.gz' } },
      }),
      { index: 0 },
    );
    expect(exportErrors.join(' ')).toMatch(/never exposure fixes/);

    const insertErrors = validateGcpWriteStepParams(
      step({
        method: 'POST',
        url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i/users',
        body: { name: 'backup', password: 'x' },
      }),
      { index: 0 },
    );
    expect(insertErrors.join(' ')).toMatch(/password-rotation shape/);
  });

  it('refuses bucket posture weakening', () => {
    const errors = validateGcpWriteStepParams(
      step({
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
        body: {
          iamConfiguration: {
            publicAccessPrevention: 'inherited',
            uniformBucketLevelAccess: { enabled: false },
          },
        },
      }),
      { index: 0 },
    );
    expect(errors).toHaveLength(2);
  });

  it('refuses firewall inserts with open ranges', () => {
    const errors = validateGcpWriteStepParams(
      step({
        method: 'POST',
        url: 'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls',
        body: {
          sourceRanges: ['0.0.0.0/0'],
          allowed: [{ IPProtocol: 'tcp' }],
        },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/widens the firewall/);
  });

  it('allows firewall inserts with private ranges', () => {
    const errors = validateGcpWriteStepParams(
      step({
        method: 'POST',
        url: 'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls',
        body: { sourceRanges: ['10.0.0.0/8'] },
      }),
      { index: 0 },
    );
    expect(errors).toEqual([]);
  });

  it('refuses split-half ranges that jointly cover everything', () => {
    const errors = validateGcpWriteStepParams(
      step({
        url: 'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls/f',
        body: { sourceRanges: ['0.0.0.0/1', '128.0.0.0/1'] },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/widens the firewall/);
  });

  it('refuses over-broad allowed protocols', () => {
    const errors = validateGcpWriteStepParams(
      step({
        url: 'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls/f',
        body: { allowed: [{ IPProtocol: 'all' }] },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/over-broad/);
  });

  it('refuses authorizedNetworks opened to the internet', () => {
    const errors = validateGcpWriteStepParams(
      step({
        url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
        body: {
          settings: {
            ipConfiguration: {
              authorizedNetworks: [{ value: '0.0.0.0/0' }],
            },
          },
        },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/authorizedNetworks/);
  });

  it('allows disabling public IP with a private IP in the real API shape', () => {
    const errors = validateGcpWriteStepParams(
      step({
        url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
        body: { settings: { ipConfiguration: { ipv4Enabled: false } } },
      }),
      {
        realState: {
          read: {
            settings: {},
            ipAddresses: [{ type: 'PRIVATE', ipAddress: '10.0.0.1' }],
          },
        },
        readSteps: [
          {
            purpose: 'read',
            url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
          },
        ],
        index: 0,
      },
    );
    expect(errors).toEqual([]);
  });

  it('refuses public ACL grants and canned ACLs', () => {
    const acl = validateGcpWriteStepParams(
      step({
        method: 'POST',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/o',
        body: { acl: [{ entity: 'allUsers', role: 'READER' }] },
      }),
      { index: 0 },
    );
    expect(acl.join(' ')).toMatch(/public/);
    const canned = validateGcpWriteStepParams(
      step({
        method: 'POST',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/o',
        body: {},
        queryParams: { predefinedAcl: 'publicRead' },
      }),
      { index: 0 },
    );
    expect(canned.join(' ')).toMatch(/public/);
  });

  it('refuses a public canned ACL hiding behind double-encoding', () => {
    // The allowlist normalizer decodes to a fixed point, so dispatch must
    // too — a single decode leaves `%62` in place, misses the storage
    // branch, and falls through to the generic checker, which never reads
    // `predefinedAcl`.
    const errors = validateGcpWriteStepParams(
      step({
        method: 'POST',
        url: 'https://storage.googleapis.com/storage/v1/%2562/my-bucket/o?predefinedAcl=publicRead',
        body: {},
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/canned ACL/);
  });

  it('refuses a public canned ACL hiding in the raw URL', () => {
    // The executor preserves `?...` in the URL and appends queryParams,
    // so a benign queryParams value must not excuse a public URL value.
    const errors = validateGcpWriteStepParams(
      step({
        method: 'POST',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/o?predefinedAcl=publicRead',
        body: {},
        queryParams: { predefinedAcl: 'private' },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/grants public access/);
  });

  it('refuses bucket IAM bindings granted to the public', () => {
    // Bucket IAM (`PUT .../iam`) never matches `:setIamPolicy`, so the
    // IAM guard never fires — the bucket validator must catch it.
    const errors = validateGcpWriteStepParams(
      step({
        method: 'PUT',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/iam',
        body: {
          bindings: [
            { role: 'roles/storage.objectViewer', members: ['allUsers'] },
          ],
        },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/"bindings" to the public/);
  });

  it('refuses databaseFlags that change a pre-existing flag value', () => {
    const errors = validateGcpWriteStepParams(
      step({
        url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
        body: {
          settings: {
            databaseFlags: [{ name: 'log_checkpoints', value: 'off' }],
          },
        },
      }),
      {
        realState: {
          read: {
            settings: {
              databaseFlags: [{ name: 'log_checkpoints', value: 'on' }],
            },
          },
        },
        readSteps: [
          {
            url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
            purpose: 'read',
          },
        ],
        index: 0,
      },
    );
    expect(errors.join(' ')).toMatch(
      /changes the value of pre-existing flag "log_checkpoints"/,
    );
  });

  it('allows unchanged databaseFlags values', () => {
    const errors = validateGcpWriteStepParams(
      step({
        url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
        body: {
          settings: {
            databaseFlags: [{ name: 'log_checkpoints', value: 'on' }],
          },
        },
      }),
      {
        realState: {
          read: {
            settings: {
              databaseFlags: [{ name: 'log_checkpoints', value: 'on' }],
            },
          },
        },
        readSteps: [
          {
            url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
            purpose: 'read',
          },
        ],
        index: 0,
      },
    );
    expect(errors).toEqual([]);
  });

  it('refuses databaseFlags that add a new flag beyond the pre-fix set', () => {
    // Instance PATCH is replace-shaped: a flag absent from the pre-fix
    // state is a change the read state cannot vouch for — keeping every
    // prior flag while appending one must still refuse.
    const errors = validateGcpWriteStepParams(
      step({
        url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
        body: {
          settings: {
            databaseFlags: [
              { name: 'log_checkpoints', value: 'on' },
              { name: 'local_infile', value: 'on' },
            ],
          },
        },
      }),
      {
        realState: {
          read: {
            settings: {
              databaseFlags: [{ name: 'log_checkpoints', value: 'on' }],
            },
          },
        },
        readSteps: [
          {
            url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
            purpose: 'read',
          },
        ],
        index: 0,
      },
    );
    expect(errors.join(' ')).toMatch(/adds new flag "local_infile"/);
  });

  it('reads prior flags from the record bound to the fix target', () => {
    // Read state is keyed by read-step purpose: flags and connectivity
    // can live in different records. The bound record is the one whose
    // read covers the fix URL — not the only record in state.
    const errors = validateGcpWriteStepParams(
      step({
        url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
        body: {
          settings: {
            databaseFlags: [{ name: 'f', value: 'on' }],
          },
        },
      }),
      {
        realState: {
          connectivity: { settings: {} },
          flags: { settings: { databaseFlags: [{ name: 'f', value: 'on' }] } },
        },
        readSteps: [
          {
            url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
            purpose: 'flags',
          },
        ],
        index: 0,
      },
    );
    expect(errors).toEqual([]);
  });

  it('refuses flags vouched only by another instance read record', () => {
    // The flag is new to the fix target but present in a different
    // instance's record. A union across records would pass it as
    // pre-existing — an unverifiable change treated as proven.
    const errors = validateGcpWriteStepParams(
      step({
        url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
        body: {
          settings: {
            databaseFlags: [{ name: 'f', value: 'on' }],
          },
        },
      }),
      {
        realState: {
          other: {
            settings: { databaseFlags: [{ name: 'f', value: 'on' }] },
          },
        },
        readSteps: [
          {
            url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/other',
            purpose: 'other',
          },
        ],
        index: 0,
      },
    );
    expect(errors.join(' ')).toMatch(/without bound read state/);
  });

  it('refuses public dataset access on hosts without a dedicated validator', () => {
    const errors = validateGcpWriteStepParams(
      step({
        method: 'PATCH',
        url: 'https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets/d',
        body: {
          access: [{ role: 'READER', specialGroup: 'allAuthenticatedUsers' }],
        },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/to the public/);
  });

  it('allows benign writes on hosts without a dedicated validator', () => {
    const errors = validateGcpWriteStepParams(
      step({
        method: 'PATCH',
        url: 'https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets/d',
        body: {
          access: [{ role: 'READER', specialGroup: 'projectReaders' }],
        },
      }),
      { index: 0 },
    );
    expect(errors).toEqual([]);
  });

  it('refuses legacy OWNER/WRITER dataset grants that skip roles/* matching', () => {
    // Dataset `access` entries carry `OWNER`/`WRITER`, never `roles/owner` —
    // an exact roles/* comparison misses the same escalation spelled short.
    for (const role of ['OWNER', 'WRITER', 'roles/bigquery.admin']) {
      const errors = validateGcpWriteStepParams(
        step({
          method: 'PATCH',
          url: 'https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets/d',
          body: {
            access: [{ role, userByEmail: 'attacker@example.com' }],
          },
        }),
        { index: 0 },
      );
      expect(errors.join(' ')).toMatch(/privileged role/);
    }
  });

  it('refuses public grants via member/members body values like the query scan', () => {
    // The query-param scan refuses ?member(s)=allUsers — bodies shaped
    // the same way must agree, including singular binding wrappers.
    for (const body of [
      { member: 'allUsers' },
      { members: ['allUsers'] },
      { binding: { role: 'roles/viewer', members: ['allUsers'] } },
    ]) {
      const errors = validateGcpWriteStepParams(
        step({
          method: 'PATCH',
          url: 'https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets/d',
          body,
        }),
        { index: 0 },
      );
      expect(errors.join(' ')).toMatch(/to the public/);
    }
  });

  it('refuses new authorized-view shares that carry no role key', () => {
    // `view` entries name no grantee, so the public, privileged-role,
    // and single-principal gates all miss them — yet adding one shares
    // the dataset with the view's readers.
    const errors = validateGcpWriteStepParams(
      step({
        method: 'PATCH',
        url: 'https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets/d',
        body: {
          access: [
            { view: { projectId: 'evil', datasetId: 'd', tableId: 'v' } },
          ],
        },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/new share/);
  });

  it('refuses dataset: and routine: shares the same way', () => {
    for (const entry of [
      { dataset: { dataset: 'projects/evil/datasets/d' } },
      { routine: { projectId: 'evil', datasetId: 'd', routineId: 'r' } },
    ]) {
      const errors = validateGcpWriteStepParams(
        step({
          method: 'PATCH',
          url: 'https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets/d',
          body: { access: [entry] },
        }),
        { index: 0 },
      );
      expect(errors.join(' ')).toMatch(/new share/);
    }
  });

  it('allows a pre-existing view share the fix retains', () => {
    const datasetUrl =
      'https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets/d';
    const view = {
      view: { projectId: 'evil', datasetId: 'd', tableId: 'v' },
    };
    const errors = validateGcpWriteStepParams(
      step({ method: 'PATCH', url: datasetUrl, body: { access: [view] } }),
      {
        realState: { read: { access: [view] } },
        readSteps: [{ url: datasetUrl, purpose: 'read' }],
        index: 0,
      },
    );
    expect(errors).toEqual([]);
  });

  it('refuses a view share swapped for a different view', () => {
    const datasetUrl =
      'https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets/d';
    const prior = {
      view: { projectId: 'evil', datasetId: 'd', tableId: 'v' },
    };
    const swapped = {
      view: { projectId: 'evil', datasetId: 'd', tableId: 'other' },
    };
    const errors = validateGcpWriteStepParams(
      step({ method: 'PATCH', url: datasetUrl, body: { access: [swapped] } }),
      {
        realState: { read: { access: [prior] } },
        readSteps: [{ url: datasetUrl, purpose: 'read' }],
        index: 0,
      },
    );
    expect(errors.join(' ')).toMatch(/new share/);
  });

  it('allows rollback restores carrying view shares', () => {
    const errors = validateGcpWriteStepParams(
      step({
        method: 'PATCH',
        url: 'https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets/d',
        body: {
          access: [
            { view: { projectId: 'evil', datasetId: 'd', tableId: 'v' } },
          ],
        },
      }),
      { index: 0, isRollback: true },
    );
    expect(errors).toEqual([]);
  });
});
