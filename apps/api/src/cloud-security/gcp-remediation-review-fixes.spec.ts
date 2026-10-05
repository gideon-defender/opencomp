import { validateGcpPlanSteps } from './gcp-plan-step-validation';
import { validateGcpWriteStepParams } from './gcp-remediation-param-guardrails';
import { isGcpReadAllowedUrl, isGcpReadOnlyMethod } from './gcp-read-allowlist';
import { isGetIamPolicyUrl } from './gcp-remediation-validator-shared';
import {
  findPriorPolicy,
  findPriorPolicyForUrl,
  findPriorStateValue,
} from './gcp-remediation-prior-state';
import {
  redactGcpBodyForLog,
  redactGcpUrlForLog,
} from './gcp-remediation-plan.utils';
import { validateGcpRollbackSteps } from './gcp-remediation-rollback-validators';

function fixStep(overrides: Record<string, unknown> = {}) {
  return {
    method: 'PATCH',
    url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
    body: {},
    purpose: 'fix',
    ...overrides,
  } as Parameters<typeof validateGcpWriteStepParams>[0];
}

describe('review fixes', () => {
  it('fails closed on undecodable URLs instead of skipping guards', () => {
    const errors = validateGcpWriteStepParams(
      fixStep({
        url: 'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls%ZZf',
        body: { sourceRanges: ['0.0.0.0/0'] },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/not parseable/);
  });

  it('refuses writes smuggled into read steps', () => {
    const errors = validateGcpPlanSteps(
      [
        {
          method: 'PATCH',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
          body: { iamConfiguration: {} },
          purpose: 'read bucket',
        },
      ],
      { isRead: true },
    );
    expect(errors.join(' ')).toMatch(/read steps must use GET/);
  });

  it('allows GET reads on known hosts and POST getIamPolicy, nothing else', () => {
    expect(
      validateGcpPlanSteps(
        [
          {
            method: 'GET',
            url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
            purpose: 'read',
          },
        ],
        {
          isRead: true,
          expectedBucket: 'my-bucket',
          expectedProjectId: 'p',
        },
      ),
    ).toEqual([]);
    expect(
      validateGcpPlanSteps(
        [
          {
            method: 'POST',
            url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p:getIamPolicy',
            body: { options: { requestedPolicyVersion: 3 } },
            purpose: 'read iam',
          },
        ],
        { isRead: true, expectedProjectId: 'p' },
      ),
    ).toEqual([]);
    expect(
      validateGcpPlanSteps(
        [
          {
            method: 'GET',
            url: 'https://evil.googleapis.com.evil.com/v1/x',
            purpose: 'read',
          },
        ],
        { isRead: true },
      ).join(' '),
    ).toMatch(/outside the allowed read hosts/);
    expect(isGcpReadOnlyMethod({ method: 'DELETE', url: 'https://x' })).toBe(
      false,
    );
    expect(isGcpReadAllowedUrl('http://storage.googleapis.com/x')).toBe(false);
  });

  it('refuses bucket bindings to a fresh principal but allows removals', () => {
    const prior = {
      bindings: [
        { role: 'roles/viewer', members: ['user:a@example.com'] },
        { role: 'roles/editor', members: ['user:b@example.com'] },
      ],
      etag: 'e',
      version: 3,
    };
    const readSteps = [
      {
        purpose: 'read',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/iam',
      },
    ];
    const escalation = validateGcpWriteStepParams(
      fixStep({
        method: 'PUT',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/iam',
        body: {
          etag: 'e',
          bindings: [
            ...prior.bindings,
            { role: 'roles/owner', members: ['user:mallory@evil.com'] },
          ],
        },
      }),
      {
        realState: { read: prior },
        readSteps,
        index: 0,
      },
    );
    expect(escalation.join(' ')).toMatch(/new principal/);
    const removal = validateGcpWriteStepParams(
      fixStep({
        method: 'PUT',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/iam',
        body: { etag: 'e', bindings: [prior.bindings[0]] },
      }),
      {
        realState: { read: prior },
        readSteps,
        index: 0,
      },
    );
    expect(removal).toEqual([]);
  });

  it('refuses bucket IAM whose etag does not match the read state', () => {
    // etag pins the revision the fix was computed against — a fabricated
    // value means the fix was not built from the read state, so the
    // whole-policy replace would silently clobber concurrent changes.
    const errors = validateGcpWriteStepParams(
      fixStep({
        method: 'PUT',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/iam',
        body: {
          etag: 'stale',
          bindings: [{ role: 'roles/viewer', members: ['user:a@example.com'] }],
        },
      }),
      {
        realState: {
          read: {
            bindings: [
              { role: 'roles/viewer', members: ['user:a@example.com'] },
            ],
            etag: 'current',
          },
        },
        readSteps: [
          {
            purpose: 'read',
            url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/iam',
          },
        ],
        index: 0,
      },
    );
    expect(errors.join(' ')).toMatch(/etag does not match/);
  });

  it('binds prior policy to the fix target and fails closed on ambiguity', () => {
    const policyA = { bindings: [{ role: 'r', members: ['a'] }], etag: 'a' };
    const policyB = { bindings: [{ role: 'r', members: ['b'] }], etag: 'b' };
    expect(findPriorPolicy({ one: policyA, two: policyB })).toBeUndefined();
    const bound = findPriorPolicyForUrl(
      { iamA: policyA, iamB: policyB },
      [
        { purpose: 'iamA', url: 'https://x.googleapis.com/v1/a:getIamPolicy' },
        { purpose: 'iamB', url: 'https://x.googleapis.com/v1/b:getIamPolicy' },
      ],
      { url: 'https://x.googleapis.com/v1/b:setIamPolicy' },
    );
    expect(bound).toEqual(policyB);
  });

  it('redacts members, ACLs, and etags before logging', () => {
    const redacted = redactGcpBodyForLog({
      bindings: [{ members: ['user:a@example.com'] }],
      etag: 'secret',
      settings: { databaseFlags: [{ name: 'f' }] },
    });
    expect(JSON.stringify(redacted)).not.toMatch(/a@example\.com/);
    expect(JSON.stringify(redacted)).not.toMatch(/secret/);
    expect(JSON.stringify(redacted)).toMatch(/redacted/);
  });

  it('redacts compound secret keys and identity material before logging', () => {
    const redacted = redactGcpBodyForLog({
      settings: {
        rootPassword: 'hunter2',
        userPassword: 'hunter3',
        dbPassword: 'hunter4',
        admin_password: 'hunter5',
      },
      serviceAccount: { email: 'svc@project.iam.gserviceaccount.com' },
      oauth: {
        refresh_token: 'token-value',
        client_secret: 'shh',
        privateKeyData: 'blob',
      },
    });
    const text = JSON.stringify(redacted);
    expect(text).not.toMatch(/hunter2/);
    expect(text).not.toMatch(/hunter3/);
    expect(text).not.toMatch(/hunter4/);
    expect(text).not.toMatch(/hunter5/);
    expect(text).not.toMatch(/svc@project/);
    expect(text).not.toMatch(/token-value/);
    expect(text).not.toMatch(/shh/);
    expect(text).not.toMatch(/blob/);
  });

  it('strips query strings and fragments from logged URLs', () => {
    expect(
      redactGcpUrlForLog(
        'https://storage.googleapis.com/storage/v1/b/my-bucket?key=SECRET#frag',
      ),
    ).toBe('https://storage.googleapis.com/storage/v1/b/my-bucket');
  });

  it('refuses an undecodable POST as a read-only method', () => {
    // The old fallback read the raw substring and let
    // `.../x%ZZ?x=:getIamPolicy` smuggle a POST write into pre-ack reads.
    expect(
      isGcpReadOnlyMethod({
        method: 'POST',
        url: 'https://storage.googleapis.com/storage/v1/b/x%ZZ?x=:getIamPolicy',
      }),
    ).toBe(false);
    expect(
      isGcpReadOnlyMethod({
        method: 'POST',
        url: 'https://cloudresourcemanager.googleapis.com/v1/projects/p:getIamPolicy',
      }),
    ).toBe(true);
  });

  it('matches encoded getIamPolicy actions like the guards do', () => {
    expect(
      isGetIamPolicyUrl(
        'https://cloudresourcemanager.googleapis.com/v1/projects/p%3AgetIamPolicy',
      ),
    ).toBe(true);
    expect(
      isGetIamPolicyUrl(
        'https://cloudresourcemanager.googleapis.com/v1/projects/p:getIamPolicy/',
      ),
    ).toBe(true);
    expect(
      isGetIamPolicyUrl(
        'https://cloudresourcemanager.googleapis.com/v1/projects/p',
      ),
    ).toBe(false);
  });

  it('refuses IAM rollback when prior state holds several policies', () => {
    const rollback = {
      method: 'POST',
      url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p:setIamPolicy',
      body: {
        policy: {
          bindings: [{ role: 'r', members: ['a'] }],
          etag: 'a',
          version: 1,
        },
      },
      purpose: 'rollback',
    };
    const errors = validateGcpRollbackSteps([rollback], {
      fixSteps: [rollback],
      previousState: {
        iamA: { bindings: [{ role: 'r', members: ['a'] }], etag: 'a' },
        iamB: { bindings: [{ role: 'r', members: ['b'] }], etag: 'b' },
      },
    });
    expect(errors.join(' ')).toMatch(/no pre-fix policy to compare/);
  });

  it('fails closed when a masked field resolves in several records', () => {
    const found = findPriorStateValue(
      {
        sqlA: { settings: { ipConfiguration: { ipv4Enabled: true } } },
        sqlB: { settings: { ipConfiguration: { ipv4Enabled: false } } },
      },
      'settings.ipConfiguration.ipv4Enabled',
    );
    expect(found).toBeUndefined();
    const single = findPriorStateValue(
      {
        sqlA: { settings: { ipConfiguration: { ipv4Enabled: true } } },
        other: { unrelated: 1 },
      },
      'settings.ipConfiguration.ipv4Enabled',
    );
    expect(single?.value).toBe(true);
  });
});
