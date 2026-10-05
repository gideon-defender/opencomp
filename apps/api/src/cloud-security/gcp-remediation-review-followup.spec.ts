import { executeGcpPlanSteps } from './gcp-command-executor';
import {
  isGcpAllowlistedFixStep,
  gcpRollbackDeletePrefixAllowed,
} from '@gideon-defender/integration-platform';
import { validateGcpWriteStepParams } from './gcp-remediation-param-guardrails';
import { isGcpReadAllowedUrl, isGcpReadOnlyMethod } from './gcp-read-allowlist';
import { extractGcpFindingProjectId } from './gcp-remediation-plan.utils';

function fixStep(overrides: Record<string, unknown> = {}) {
  return {
    method: 'PATCH',
    url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
    body: {},
    purpose: 'fix',
    ...overrides,
  } as Parameters<typeof validateGcpWriteStepParams>[0];
}

describe('review followups: dispatcher and allowlist hardening', () => {
  it('routes firewall :setIamPolicy to the IAM removal-only guard', () => {
    const errors = validateGcpWriteStepParams(
      fixStep({
        method: 'POST',
        url: 'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls/f:setIamPolicy',
        body: {
          policy: {
            bindings: [
              { role: 'roles/viewer', members: ['user:new@evil.com'] },
            ],
            etag: 'e',
            version: 3,
          },
        },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/setIamPolicy/);
  });

  it('refuses path traversal outside the class prefix', () => {
    expect(
      isGcpAllowlistedFixStep({
        assetClass: 'Storage',
        method: 'PATCH',
        url: 'https://storage.googleapis.com/storage/v1/b/x/../../compute/v1/projects/p',
      }),
    ).toBe(false);
    expect(
      isGcpAllowlistedFixStep({
        assetClass: 'Storage',
        method: 'PATCH',
        url: 'https://storage.googleapis.com/storage/v1/b/%2e%2e/compute/v1/projects/p',
      }),
    ).toBe(false);
    expect(
      isGcpAllowlistedFixStep({
        assetClass: 'Storage',
        method: 'PATCH',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
      }),
    ).toBe(true);
  });

  it('keeps rollback DELETEs prefix-scoped after normalization', () => {
    expect(
      gcpRollbackDeletePrefixAllowed({
        assetClass: 'Storage',
        url: 'https://storage.googleapis.com/storage/v1/b/x/../../iam/v1/x',
      }),
    ).toBe(false);
  });

  it('refuses privileged role grants on generic paths', () => {
    const errors = validateGcpWriteStepParams(
      fixStep({
        method: 'PATCH',
        url: 'https://pubsub.googleapis.com/v1/projects/p/topics/t:setIamPolicy',
        body: {
          bindings: [
            { role: 'roles/owner', members: ['user:mallory@evil.com'] },
          ],
        },
      }),
      { index: 0 },
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('refuses privileged dataset roles on generic paths', () => {
    const errors = validateGcpWriteStepParams(
      fixStep({
        url: 'https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets/d',
        body: { access: [{ role: 'roles/owner', userByEmail: 'm@evil.com' }] },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/privileged role/);
  });

  it('allows benign dataset grants on generic paths', () => {
    const errors = validateGcpWriteStepParams(
      fixStep({
        url: 'https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets/d',
        body: { access: [{ role: 'READER', specialGroup: 'projectReaders' }] },
      }),
      { index: 0 },
    );
    expect(errors).toEqual([]);
  });

  it('refuses bucket defaultObjectAcl grants to new entities', () => {
    const errors = validateGcpWriteStepParams(
      fixStep({
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
        body: {
          defaultObjectAcl: [{ entity: 'user-new@evil.com', role: 'OWNER' }],
        },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/defaultObjectAcl/);
  });

  it('allows bucket ACL removals that narrow prior state', () => {
    const priorAcl = [
      { entity: 'project-owners', role: 'OWNER' },
      { entity: 'allUsers', role: 'READER' },
    ];
    const errors = validateGcpWriteStepParams(
      fixStep({
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
        body: { acl: [{ entity: 'project-owners', role: 'OWNER' }] },
      }),
      {
        realState: { read: { acl: priorAcl } },
        readSteps: [
          {
            purpose: 'read',
            url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
          },
        ],
        index: 0,
      },
    );
    expect(errors).toEqual([]);
  });

  it('dispatches on hostname, not substrings', () => {
    // A SQL-shaped body on a spoofed hostname must not reach the SQL
    // validator: without read state the SQL guard refuses flag edits,
    // while the generic backstop (no bindings/access) passes.
    for (const url of [
      'https://evil.com/?x=sqladmin.googleapis.com/v1/projects/p',
      'https://sqladmin.googleapis.com.evil.com/v1/projects/p',
    ]) {
      const errors = validateGcpWriteStepParams(
        fixStep({
          method: 'PATCH',
          url,
          body: { settings: { databaseFlags: [{ name: 'f', value: 'on' }] } },
        }),
        { index: 0 },
      );
      expect(errors).toEqual([]);
    }
    // The same body on the real host is refused without read state.
    const real = validateGcpWriteStepParams(
      fixStep({
        method: 'PATCH',
        url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i',
        body: { settings: { databaseFlags: [{ name: 'f', value: 'on' }] } },
      }),
      { index: 0 },
    );
    expect(real.join(' ')).toMatch(/databaseFlags/);
  });

  it('refuses read executions that carry rollback steps', async () => {
    const result = await executeGcpPlanSteps({
      steps: [
        {
          method: 'GET',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
          purpose: 'read',
        },
      ],
      accessToken: 'token',
      autoRollbackSteps: [
        {
          method: 'PATCH',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
          body: { iamConfiguration: {} },
          purpose: 'rollback',
        },
      ],
      isRead: true,
      expectedBucket: 'my-bucket',
      expectedProjectId: 'p',
    });
    expect(result.error?.message).toMatch(/cannot carry rollback steps/);
    expect(result.results).toEqual([]);
  });

  it('pins read hosts and read-only shapes', () => {
    for (const host of [
      'https://logging.googleapis.com/v2/projects/p',
      'https://container.googleapis.com/v1/projects/p',
      'https://iam.googleapis.com/v1/projects/p',
      'https://cloudresourcemanager.googleapis.com/v3/projects/p',
    ]) {
      expect(isGcpReadAllowedUrl(host)).toBe(true);
    }
    expect(isGcpReadAllowedUrl('https://evil.googleapis.com.evil.com/')).toBe(
      false,
    );
    expect(
      isGcpReadOnlyMethod({
        method: 'POST',
        url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p:getIamPolicy',
      }),
    ).toBe(true);
    expect(
      isGcpReadOnlyMethod({
        method: 'POST',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
      }),
    ).toBe(false);
  });

  it('binds SQL prior state to the fix URL', () => {
    // The qualifying record is deliberately NOT first in state: URL
    // binding must pick the target's record — a global first-match would
    // refuse a valid connectivity fix (and the mirror test below shows it
    // would allow an invalid one).
    const good = validateGcpWriteStepParams(
      fixStep({
        method: 'PATCH',
        url: 'https://sqladmin.googleapis.com/v1/projects/a/instances/i',
        body: { settings: { ipConfiguration: { ipv4Enabled: false } } },
      }),
      {
        realState: {
          b: { settings: {}, ipAddresses: [{ type: 'PRIMARY' }] },
          a: { settings: {}, ipAddresses: [{ type: 'PRIVATE' }] },
        },
        readSteps: [
          {
            purpose: 'a',
            url: 'https://sqladmin.googleapis.com/v1/projects/a/instances/i',
          },
          {
            purpose: 'b',
            url: 'https://sqladmin.googleapis.com/v1/projects/b/instances/j',
          },
        ],
        index: 0,
      },
    );
    expect(good).toEqual([]);
  });

  it('refuses when only the non-target record carries the private IP', () => {
    // The cross-resource confusion URL binding exists to prevent: the fix
    // targets instance `a`, but only instance `b` has a private IP. A
    // first-match pick would bind B's connectivity state to A's fix and
    // allow breaking A's public access.
    const bad = validateGcpWriteStepParams(
      fixStep({
        method: 'PATCH',
        url: 'https://sqladmin.googleapis.com/v1/projects/a/instances/i',
        body: { settings: { ipConfiguration: { ipv4Enabled: false } } },
      }),
      {
        realState: {
          b: { settings: {}, ipAddresses: [{ type: 'PRIVATE' }] },
          a: { settings: {}, ipAddresses: [{ type: 'PRIMARY' }] },
        },
        readSteps: [
          {
            purpose: 'a',
            url: 'https://sqladmin.googleapis.com/v1/projects/a/instances/i',
          },
          {
            purpose: 'b',
            url: 'https://sqladmin.googleapis.com/v1/projects/b/instances/j',
          },
        ],
        index: 0,
      },
    );
    expect(bad.join(' ')).toMatch(/private IP/);
  });

  it('resolves the finding project id with evidence priority', () => {
    expect(
      extractGcpFindingProjectId({
        evidence: { projectId: '  p1  ' },
        resourceId: 'projects/p2/instances/i',
      }),
    ).toBe('p1');
    expect(
      extractGcpFindingProjectId({
        evidence: {},
        resourceId: 'projects/p2/instances/i',
      }),
    ).toBe('p2');
    expect(
      extractGcpFindingProjectId({
        evidence: { projectDisplayName: 'pretty' },
        resourceId: null,
      }),
    ).toBe('pretty');
  });
});
