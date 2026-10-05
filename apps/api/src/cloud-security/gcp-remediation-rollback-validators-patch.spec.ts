import { validateGcpRollbackSteps } from './gcp-remediation-rollback-validators';

/**
 * Value-equality checks for PUT/PATCH rollbacks against pre-fix read
 * state: dotted `updateMask` paths, per-field record resolution, and
 * fail-closed behavior when a field cannot be verified.
 */

const SQL_URL = 'https://sqladmin.googleapis.com/v1/projects/p/instances/i';
const SQL_FIX = { method: 'PATCH', url: SQL_URL, purpose: 'fix' };
const SQL_READ_STEPS = [{ purpose: 'read', url: SQL_URL }];

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
    url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p:setIamPolicy',
    body: { policy },
    purpose: 'rollback',
  };
}

describe('validateGcpRollbackSteps dotted updateMask paths', () => {
  it('accepts a dotted mask that restores the nested prior value', () => {
    expect(
      validateGcpRollbackSteps(
        [
          {
            method: 'PATCH',
            url: SQL_URL,
            body: { settings: { ipConfiguration: { ipv4Enabled: true } } },
            queryParams: {
              updateMask: 'settings.ipConfiguration.ipv4Enabled',
            },
            purpose: 'rollback',
          },
        ],
        {
          fixSteps: [SQL_FIX],
          previousState: {
            read: { settings: { ipConfiguration: { ipv4Enabled: true } } },
          },
          readSteps: SQL_READ_STEPS,
          expectedProjectId: 'p',
        },
      ),
    ).toEqual([]);
  });

  it('refuses a dotted mask that writes a third state', () => {
    const errors = validateGcpRollbackSteps(
      [
        {
          method: 'PATCH',
          url: SQL_URL,
          body: { settings: { ipConfiguration: { ipv4Enabled: false } } },
          queryParams: {
            updateMask: 'settings.ipConfiguration.ipv4Enabled',
          },
          purpose: 'rollback',
        },
      ],
      {
        previousState: {
          read: { settings: { ipConfiguration: { ipv4Enabled: true } } },
        },
        readSteps: SQL_READ_STEPS,
      },
    );
    expect(errors.join(' ')).toMatch(
      /does not restore the pre-fix value of "settings.ipConfiguration.ipv4Enabled"/,
    );
  });

  it('refuses a masked field missing from every pre-fix record', () => {
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
        previousState: { read: { somethingElse: {} } },
      },
    );
    expect(errors.join(' ')).toMatch(/no pre-fix value to compare/);
  });

  it('resolves masked fields across different read-state records', () => {
    expect(
      validateGcpRollbackSteps(
        [
          {
            method: 'PATCH',
            url: SQL_URL,
            body: {
              settings: {
                ipConfiguration: { ipv4Enabled: true },
                databaseFlags: [{ name: 'f', value: 'on' }],
              },
            },
            queryParams: {
              updateMask:
                'settings.ipConfiguration.ipv4Enabled,settings.databaseFlags',
            },
            purpose: 'rollback',
          },
        ],
        {
          previousState: {
            connectivity: {
              settings: { ipConfiguration: { ipv4Enabled: true } },
            },
            flags: {
              settings: { databaseFlags: [{ name: 'f', value: 'on' }] },
            },
          },
          readSteps: [
            { purpose: 'connectivity', url: SQL_URL },
            { purpose: 'flags', url: SQL_URL },
          ],
          expectedProjectId: 'p',
        },
      ),
    ).toEqual([]);
  });

  it('routes percent-encoded :setIamPolicy through IAM validation', () => {
    // WHATWG keeps %3A encoded in pathname, but the server decodes it —
    // the guard must see the same action the fetch executes. Without the
    // decoded match this skips IAM validation and only fails overlap.
    const errors = validateGcpRollbackSteps(
      [
        {
          method: 'POST',
          url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p%3AsetIamPolicy',
          body: {
            policy: {
              bindings: [
                { role: 'roles/editor', members: ['mallory@evil.example'] },
              ],
              etag: 'e1',
              version: 1,
            },
          },
          purpose: 'rollback',
        },
      ],
      {
        fixSteps: [iamRollback({ ...PRIOR_STATE.read })],
        previousState: PRIOR_STATE,
        readSteps: [
          {
            purpose: 'read',
            url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p:getIamPolicy',
          },
        ],
      },
    );
    expect(errors.join(' ')).toMatch(/differ from the pre-fix policy/);
  });

  it('binds bucket prior state through readSteps in rollback', () => {
    // Two policy records make the global lookup ambiguous — without the
    // fix plan's readSteps the URL-bound lookup degrades and a valid
    // restore is refused, leaving the fix without its safety net.
    const binding = { role: 'roles/viewer', members: ['alice@example.com'] };
    const step = {
      method: 'POST',
      url: 'https://storage.googleapis.com/storage/v1/b/bucket-a/iam',
      body: { bindings: [binding] },
      purpose: 'rollback',
    };
    const args = {
      fixSteps: [step],
      previousState: {
        readA: { bindings: [binding] },
        readB: {
          bindings: [{ role: 'roles/editor', members: ['bob@example.com'] }],
        },
      },
    };
    const unbound = validateGcpRollbackSteps([step], args);
    expect(unbound.join(' ')).toMatch(/new principal/);
    expect(
      validateGcpRollbackSteps([step], {
        ...args,
        readSteps: [
          {
            purpose: 'readA',
            url: 'https://storage.googleapis.com/storage/v1/b/bucket-a/iam',
          },
        ],
        expectedBucket: 'bucket-a',
      }),
    ).toEqual([]);
  });

  it('refuses a PATCH rollback with body keys outside the updateMask', () => {
    // The masked field restores its prior value, but the body smuggles
    // an extra write the mask never names — it must not run uncompared.
    const errors = validateGcpRollbackSteps(
      [
        {
          method: 'PATCH',
          url: SQL_URL,
          body: {
            settings: { ipConfiguration: { ipv4Enabled: true } },
            labels: { rollback: 'true' },
          },
          queryParams: {
            updateMask: 'settings.ipConfiguration.ipv4Enabled',
          },
          purpose: 'rollback',
        },
      ],
      {
        fixSteps: [SQL_FIX],
        previousState: {
          read: { settings: { ipConfiguration: { ipv4Enabled: true } } },
        },
        readSteps: SQL_READ_STEPS,
      },
    );
    expect(errors.join(' ')).toMatch(/outside updateMask/);
  });

  it('refuses a smuggled sibling inside a masked subtree', () => {
    // Only the masked leaf is compared per-field; a tampered sibling
    // under the same top-level key must still prove its prior value.
    const errors = validateGcpRollbackSteps(
      [
        {
          method: 'PATCH',
          url: SQL_URL,
          body: {
            settings: {
              ipConfiguration: { ipv4Enabled: true },
              maintenanceWindow: { day: 7 },
            },
          },
          queryParams: {
            updateMask: 'settings.ipConfiguration.ipv4Enabled',
          },
          purpose: 'rollback',
        },
      ],
      {
        fixSteps: [SQL_FIX],
        previousState: {
          read: {
            settings: {
              ipConfiguration: { ipv4Enabled: true },
              maintenanceWindow: { day: 1 },
            },
          },
        },
        readSteps: SQL_READ_STEPS,
      },
    );
    expect(errors.join(' ')).toMatch(/outside updateMask/);
  });

  it('accepts mask-external leaves that still equal pre-fix state', () => {
    // No unreviewed write happens when the extra carried value already
    // matches what the resource holds — the rollback restores nothing new.
    expect(
      validateGcpRollbackSteps(
        [
          {
            method: 'PATCH',
            url: SQL_URL,
            body: {
              settings: {
                ipConfiguration: { ipv4Enabled: true },
                maintenanceWindow: { day: 1 },
              },
            },
            queryParams: {
              updateMask: 'settings.ipConfiguration.ipv4Enabled',
            },
            purpose: 'rollback',
          },
        ],
        {
          fixSteps: [SQL_FIX],
          previousState: {
            read: {
              settings: {
                ipConfiguration: { ipv4Enabled: true },
                maintenanceWindow: { day: 1 },
              },
            },
          },
          readSteps: SQL_READ_STEPS,
          expectedProjectId: 'p',
        },
      ),
    ).toEqual([]);
  });
});
