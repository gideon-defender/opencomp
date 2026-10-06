import {
  executeGcpPlanSteps,
  sanitizeGcpErrorForLog,
} from './gcp-command-executor';
import {
  validateGcpPlanSteps,
  type GcpApiStep,
} from './gcp-plan-step-validation';

const STORAGE_PATCH = {
  method: 'PATCH' as const,
  url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
  body: { iamConfiguration: {} },
  purpose: 'fix',
};

describe('validateGcpPlanSteps allowlist enforcement', () => {
  it('passes allowlisted fix steps without enforcement (reads path)', () => {
    expect(
      validateGcpPlanSteps([STORAGE_PATCH], {
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
      }),
    ).toEqual([]);
  });

  it('accepts class-scoped writes when enforced', () => {
    expect(
      validateGcpPlanSteps([STORAGE_PATCH], {
        assetClass: 'Storage',
        enforceAllowlist: true,
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
      }),
    ).toEqual([]);
  });

  it('refuses cross-class writes when enforced', () => {
    const errors = validateGcpPlanSteps(
      [
        {
          method: 'PATCH',
          url: 'https://compute.googleapis.com/compute/v1/projects/p/zones/z/instances/i',
          body: { a: 1 },
          purpose: 'fix',
        },
      ],
      { assetClass: 'Storage', enforceAllowlist: true },
    );
    expect(errors.join(' ')).toMatch(/not allowlisted for Storage/);
  });

  it('fails closed when enforcement is requested without an asset class', () => {
    // The allowlist block needs a class to verdict against — without one
    // it must refuse instead of silently skipping the check.
    const errors = validateGcpPlanSteps([STORAGE_PATCH], {
      enforceAllowlist: true,
    });
    expect(errors).toEqual([
      'Allowlist enforcement requires an asset class — refused for safety',
    ]);
  });

  it('reports a missing method once instead of cascading', () => {
    // AI JSON arrives untyped: without a method every downstream check
    // (read-only shape, allowlist) would pile on with misleading errors or
    // throw on undefined. One error, then the next step.
    const stepWithoutMethod = {
      url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
      purpose: 'fix',
    };
    const errors = validateGcpPlanSteps(
      [stepWithoutMethod as unknown as GcpApiStep],
      { assetClass: 'Storage', enforceAllowlist: true },
    );
    expect(errors).toEqual(['Step 1: method is required']);
  });

  it('refuses steps naming another project when bound', () => {
    const errors = validateGcpPlanSteps(
      [
        {
          method: 'PATCH',
          url: 'https://compute.googleapis.com/compute/v1/projects/other/global/firewalls/f',
          body: { description: 'x' },
          purpose: 'fix',
        },
      ],
      {
        assetClass: 'Network',
        enforceAllowlist: true,
        expectedProjectId: 'mine',
      },
    );
    expect(errors.join(' ')).toMatch(/targets project "other"/);
  });

  it('accepts same-project steps when bound', () => {
    expect(
      validateGcpPlanSteps(
        [
          {
            method: 'GET',
            url: 'https://compute.googleapis.com/compute/v1/projects/mine/global/firewalls/f',
            purpose: 'read',
          },
        ],
        { isRead: true, expectedProjectId: 'mine' },
      ),
    ).toEqual([]);
  });

  it('refuses never-allow permissions in step bodies', () => {
    const errors = validateGcpPlanSteps(
      [
        {
          method: 'POST',
          url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p:setIamPolicy',
          body: {
            policy: {},
            permission: 'resourcemanager.projects.setIamPolicy',
          },
          purpose: 'fix',
        },
      ],
      { assetClass: 'Security-Global', enforceAllowlist: true },
    );
    expect(errors.join(' ')).toMatch(/never allowed/);
  });

  it('refuses never-allow permissions smuggled as method+URL deletes', () => {
    const errors = validateGcpPlanSteps(
      [
        {
          method: 'DELETE',
          url: 'https://compute.googleapis.com/compute/v1/projects/p/zones/z/instances/victim',
          purpose: 'fix',
        },
      ],
      { assetClass: 'Compute', enforceAllowlist: true },
    );
    expect(errors.join(' ')).toMatch(
      /compute\.instances\.delete.*never allowed/,
    );
  });

  it('does not mistake an object delete for a bucket delete', () => {
    const errors = validateGcpPlanSteps(
      [
        {
          method: 'DELETE',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/o/my-object',
          purpose: 'fix',
        },
      ],
      { assetClass: 'Storage', enforceAllowlist: true },
    );
    expect(errors.join(' ')).not.toMatch(/storage\.buckets\.delete/);
  });

  it('allows prefix-scoped DELETE only on the rollback path', () => {
    const step = {
      method: 'DELETE' as const,
      url: 'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls/f',
      purpose: 'rollback',
    };
    expect(
      validateGcpPlanSteps([step], {
        assetClass: 'Network',
        enforceAllowlist: true,
        isRollback: true,
        expectedProjectId: 'p',
      }),
    ).toEqual([]);
    expect(
      validateGcpPlanSteps([step], {
        assetClass: 'Network',
        enforceAllowlist: true,
      }),
    ).not.toEqual([]);
  });

  it('refuses rollback DELETEs outside the class API prefixes', () => {
    const errors = validateGcpPlanSteps(
      [
        {
          method: 'DELETE',
          url: 'https://iam.googleapis.com/v1/projects/p/serviceAccounts/s',
          purpose: 'rollback',
        },
      ],
      {
        assetClass: 'Network',
        enforceAllowlist: true,
        isRollback: true,
        expectedProjectId: 'p',
      },
    );
    expect(errors.join(' ')).toMatch(/not allowlisted for Network/);
  });

  it('refuses mismatched rollback length before executing anything', async () => {
    // The auto-rollback loop compensates by position, so a shorter or
    // longer rollback array would compensate the wrong steps.
    const result = await executeGcpPlanSteps({
      steps: [STORAGE_PATCH, STORAGE_PATCH],
      accessToken: 'token',
      expectedProjectId: 'my-proj',
      expectedBucket: 'my-bucket',
      autoRollbackSteps: [
        {
          method: 'DELETE',
          url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
          purpose: 'rollback',
        },
      ],
    });
    expect(result.results).toEqual([]);
    expect(result.error?.message).toMatch(/Rollback mismatch/);
  });

  it('refuses non-allowlisted auto-rollback steps before executing anything', async () => {
    const result = await executeGcpPlanSteps({
      steps: [STORAGE_PATCH],
      accessToken: 'token',
      autoRollbackSteps: [
        {
          method: 'DELETE',
          url: 'https://iam.googleapis.com/v1/projects/p/serviceAccounts/s',
          purpose: 'rollback',
        },
      ],
      assetClass: 'Storage',
      enforceAllowlist: true,
    });
    expect(result.results).toEqual([]);
    expect(result.error?.message).toMatch(/not allowlisted for Storage/);
  });
  it('does not auto-enable an API named in error text that is not the step host', async () => {
    // The API name comes from untrusted error text — enabling anything
    // other than the step's own API would turn reflected input into a
    // config-changing write outside the allowlist.
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message:
              'Compute Engine API has not been used in project p before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/compute.googleapis.com/overview?project=p',
            status: 'SERVICE_DISABLED',
          },
        }),
        {
          // 400 (not 403): a 403 body hits the permission-denied path
          // before the retry logic ever sees the message.
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    try {
      const result = await executeGcpPlanSteps({
        steps: [STORAGE_PATCH],
        accessToken: 'token',
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
      });
      expect(result.error?.message).toMatch(/GCP API error/);
      // One call for the step itself — no second call to serviceusage.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        fetchMock.mock.calls.some(([url]) => {
          if (typeof url !== 'string' && !(url instanceof URL)) return false;
          try {
            return (
              new URL(String(url)).hostname.toLowerCase() ===
              'serviceusage.googleapis.com'
            );
          } catch {
            return false;
          }
        }),
      ).toBe(false);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('never auto-enables APIs on the read path', async () => {
    // Reads run pre-acknowledgment with the auditor token: a
    // `services:enable` write there would execute a billable config change
    // outside every allowlist. The read fails instead — the fix path
    // retries with the write identity.
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message:
              'Storage API has not been used in project p before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/storage.googleapis.com/overview?project=p',
            status: 'SERVICE_DISABLED',
          },
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    try {
      const result = await executeGcpPlanSteps({
        steps: [
          {
            method: 'GET',
            url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
            purpose: 'read bucket',
          },
        ],
        accessToken: 'auditor-token',
        isRead: true,
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
      });
      expect(result.error?.message).toMatch(/GCP API error/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        fetchMock.mock.calls.some(([url]) => {
          if (typeof url !== 'string' && !(url instanceof URL)) return false;
          try {
            return (
              new URL(String(url)).hostname.toLowerCase() ===
              'serviceusage.googleapis.com'
            );
          } catch {
            return false;
          }
        }),
      ).toBe(false);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('refuses GET fix steps outside the read-allowed hosts', () => {
    // GET steps run with the fix token: an arbitrary-host GET is recon
    // outside the class scope, not a harmless read.
    const errors = validateGcpPlanSteps(
      [
        {
          method: 'GET',
          url: 'https://secretmanager.googleapis.com/v1/projects/p/secrets',
          purpose: 'fix',
        },
      ],
      { assetClass: 'Storage', enforceAllowlist: true },
    );
    expect(errors.join(' ')).toMatch(/not allowlisted for Storage/);
  });

  it('allows GET fix steps to read-allowed hosts', () => {
    expect(
      validateGcpPlanSteps(
        [
          {
            method: 'GET',
            url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
            purpose: 'fix',
          },
        ],
        {
          assetClass: 'Storage',
          enforceAllowlist: true,
          expectedProjectId: 'my-proj',
          expectedBucket: 'my-bucket',
        },
      ),
    ).toEqual([]);
  });

  it('treats an empty rollback array as no safety net, not a mismatch', async () => {
    // The service drops invalid rollbacks to [] — that must read as
    // "absent" (fix proceeds without auto-rollback), not as a 1:1
    // violation that refuses the whole execution.
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    try {
      const result = await executeGcpPlanSteps({
        steps: [STORAGE_PATCH],
        accessToken: 'token',
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
        autoRollbackSteps: [],
      });
      expect(result.error).toBeUndefined();
      expect(result.results).toHaveLength(1);
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe('executeGcpPlanSteps execution hardening', () => {
  function jsonResponse(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function requestUrlOf(url: string | URL | Request): string {
    if (typeof url === 'string') return url;
    if (url instanceof URL) return url.href;
    return url.url;
  }

  it('treats 409 already-exists as idempotent success for POST creates', async () => {
    const post = { ...STORAGE_PATCH, method: 'POST' as const };
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse(
          { error: { message: 'exists', status: 'ALREADY_EXISTS' } },
          409,
        ),
      );
    try {
      const result = await executeGcpPlanSteps({
        steps: [post],
        accessToken: 'token',
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
      });
      expect(result.error).toBeUndefined();
      expect(result.results).toHaveLength(1);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('fails a PATCH step on 409: the write was rejected, not applied', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse(
          { error: { message: 'condition not met', status: 'ABORTED' } },
          409,
        ),
      );
    try {
      const result = await executeGcpPlanSteps({
        steps: [STORAGE_PATCH],
        accessToken: 'token',
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
      });
      expect(result.error?.message).toMatch(/rejected \(conflict\)/);
      expect(result.results).toHaveLength(0);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('does not retry a write when only a resource name looks like a 5xx', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse(
          { error: { message: 'bucket project-5001 not found' } },
          400,
        ),
      );
    try {
      const result = await executeGcpPlanSteps({
        steps: [STORAGE_PATCH],
        accessToken: 'token',
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
      });
      expect(result.error?.message).toMatch(/project-5001/);
      // One call: digits in a name must not trigger the 5xx retry loop.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('fails a DONE operation that carries a bare error object', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        jsonResponse(
          {
            kind: 'compute#operation',
            status: 'DONE',
            selfLink:
              'https://compute.googleapis.com/compute/v1/projects/p/operations/op-1',
            error: { code: 403, message: 'quota exceeded' },
          },
          200,
        ),
      );
    try {
      const result = await executeGcpPlanSteps({
        steps: [STORAGE_PATCH],
        accessToken: 'token',
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
      });
      expect(result.error?.message).toMatch(/quota exceeded/);
      expect(result.results).toHaveLength(0);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('skips rollback for a fix step that 409d: nothing was created', async () => {
    const created = { ...STORAGE_PATCH, method: 'POST' as const };
    const rollbackCreate = {
      method: 'DELETE' as const,
      url: created.url,
      purpose: 'rollback-create',
    };
    const fetchedUrls: string[] = [];
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url: string | URL | Request) => {
        fetchedUrls.push(requestUrlOf(url));
        // First fix step 409s (already exists); second fails non-retryably.
        if (fetchedUrls.length === 1) {
          return jsonResponse(
            { error: { message: 'exists', status: 'ALREADY_EXISTS' } },
            409,
          );
        }
        return jsonResponse({ error: { message: 'boom' } }, 400);
      });
    try {
      const result = await executeGcpPlanSteps({
        steps: [created, STORAGE_PATCH],
        accessToken: 'token',
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
        autoRollbackSteps: [
          rollbackCreate,
          { ...rollbackCreate, purpose: 'rollback-second' },
        ],
      });
      expect(result.error?.message).toMatch(/boom/);
      // Only the two fix calls run — the rollback for the 409d create
      // must not execute (it would delete a pre-existing resource).
      expect(fetchedUrls).toHaveLength(2);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('never follows redirects: the bearer token must not leak cross-origin', async () => {
    const inits: RequestInit[] = [];
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async (_url: string | URL | Request, init?: RequestInit) => {
          if (init) inits.push(init);
          return jsonResponse({}, 200);
        },
      );
    try {
      const result = await executeGcpPlanSteps({
        steps: [STORAGE_PATCH],
        accessToken: 'token',
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
      });
      expect(result.error).toBeUndefined();
      expect(inits.length).toBeGreaterThan(0);
      for (const init of inits) {
        expect(init.redirect).toBe('error');
      }
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('refuses to poll operation selfLinks outside Google APIs', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          kind: 'compute#operation',
          selfLink: 'https://evil.example.com/operations/op-1',
        },
        200,
      ),
    );
    try {
      const result = await executeGcpPlanSteps({
        steps: [STORAGE_PATCH],
        accessToken: 'token',
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
      });
      expect(result.error?.message).toMatch(/disallowed host/);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('refuses non-HTTPS operation selfLinks', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          kind: 'compute#operation',
          selfLink:
            'http://compute.googleapis.com/compute/v1/projects/p/operations/op-1',
        },
        200,
      ),
    );
    try {
      const result = await executeGcpPlanSteps({
        steps: [STORAGE_PATCH],
        accessToken: 'token',
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
      });
      expect(result.error?.message).toMatch(/must use HTTPS/);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('fails an unpolled operation that is not DONE', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse({ kind: 'compute#operation', status: 'RUNNING' }, 200),
      );
    try {
      const result = await executeGcpPlanSteps({
        steps: [STORAGE_PATCH],
        accessToken: 'token',
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
      });
      expect(result.error?.message).toMatch(/no selfLink/);
      expect(result.results).toHaveLength(0);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('accepts a DONE operation without selfLink as terminal', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse({ kind: 'compute#operation', status: 'DONE' }, 200),
      );
    try {
      const result = await executeGcpPlanSteps({
        steps: [STORAGE_PATCH],
        accessToken: 'token',
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
      });
      expect(result.error).toBeUndefined();
      expect(result.results).toHaveLength(1);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('compensates completed steps on partial failure', async () => {
    const stepB = {
      ...STORAGE_PATCH,
      url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/o/object-b',
    };
    const rollbackA = {
      method: 'PATCH' as const,
      url: STORAGE_PATCH.url,
      body: { iamConfiguration: {} },
      purpose: 'rollback-a',
    };
    const rollbackB = {
      method: 'PATCH' as const,
      url: stepB.url,
      body: { iamConfiguration: {} },
      purpose: 'rollback-b',
    };
    const fetchedUrls: string[] = [];
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url: string | URL | Request) => {
        fetchedUrls.push(requestUrlOf(url));
        // First fix step succeeds; second fails non-retryably; rollbacks OK.
        if (fetchedUrls.length === 2) {
          return jsonResponse({ error: { message: 'boom' } }, 400);
        }
        return jsonResponse({}, 200);
      });
    try {
      const result = await executeGcpPlanSteps({
        steps: [STORAGE_PATCH, stepB],
        accessToken: 'token',
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
        autoRollbackSteps: [rollbackA, rollbackB],
      });
      expect(result.error?.message).toMatch(/boom/);
      expect(result.results).toHaveLength(1);
      // Step A, step B, then compensation for step A (position 0).
      expect(fetchedUrls).toHaveLength(3);
      expect(fetchedUrls[2]).toBe(rollbackA.url);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('surfaces failed auto-enablement instead of retrying blindly', async () => {
    // Storage bucket URLs carry no /projects/ segment — there is no project
    // to enable the API in, so enablement fails fast with no serviceusage call.
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          error: {
            message:
              'Storage API storage.googleapis.com has not been used in project my-bucket before or it is disabled.',
            status: 'SERVICE_DISABLED',
          },
        },
        400,
      ),
    );
    try {
      const result = await executeGcpPlanSteps({
        steps: [STORAGE_PATCH],
        accessToken: 'token',
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
      });
      expect(result.error?.message).toMatch(/auto-enablement failed/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('extracts the enablement project from the pathname only, never the query', async () => {
    // The query string is AI-controlled: `?x=/projects/validproj1` must not
    // select the project for a billable services:enable write.
    const step = {
      method: 'PATCH' as const,
      url: 'https://compute.googleapis.com/compute/v1/zones?x=/projects/validproj1',
      body: { description: 'x' },
      purpose: 'fix',
    };
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          error: {
            message:
              'Compute API compute.googleapis.com has not been used before or it is disabled.',
            status: 'SERVICE_DISABLED',
          },
        },
        400,
      ),
    );
    try {
      const result = await executeGcpPlanSteps({
        steps: [step],
        accessToken: 'token',
      });
      expect(result.error?.message).toMatch(/auto-enablement failed/);
      // Step call only — no serviceusage enablement call.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('refuses auto-enablement for project segments outside the safe pattern', async () => {
    const step = {
      method: 'PATCH' as const,
      url: 'https://compute.googleapis.com/compute/v1/projects/!!/zones',
      body: { description: 'x' },
      purpose: 'fix',
    };
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          error: {
            message:
              'Compute API compute.googleapis.com has not been used before or it is disabled.',
            status: 'SERVICE_DISABLED',
          },
        },
        400,
      ),
    );
    try {
      const result = await executeGcpPlanSteps({
        steps: [step],
        accessToken: 'token',
        expectedProjectId: '!!',
      });
      expect(result.error?.message).toMatch(/auto-enablement failed/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('surfaces a failed serviceusage enablement instead of retrying', async () => {
    const step = {
      method: 'PATCH' as const,
      url: 'https://compute.googleapis.com/compute/v1/projects/validproj1/zones',
      body: { description: 'x' },
      purpose: 'fix',
    };
    // Exact-host match: a substring check would also match an
    // attacker-shaped host containing the allowlisted name.
    function isServiceUsageUrl(url: string | URL | Request): boolean {
      try {
        return (
          new URL(requestUrlOf(url)).hostname === 'serviceusage.googleapis.com'
        );
      } catch {
        return false;
      }
    }
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url: string | URL | Request) => {
        if (isServiceUsageUrl(url)) {
          return jsonResponse({ error: { message: 'denied' } }, 500);
        }
        return jsonResponse(
          {
            error: {
              message:
                'Compute API compute.googleapis.com has not been used before or it is disabled.',
              status: 'SERVICE_DISABLED',
            },
          },
          400,
        );
      });
    try {
      const result = await executeGcpPlanSteps({
        steps: [step],
        accessToken: 'token',
        expectedProjectId: 'validproj1',
      });
      expect(result.error?.message).toMatch(/auto-enablement failed/);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('upgrades slash-encoded CRM v1 paths to canonical v3', async () => {
    // `%2F` keeps the raw string free of `/v1/projects/`, so a raw
    // substring replace is a no-op while the decoded guard matched — the
    // step would run as v1 and silently drop auditConfigs.
    let fetchedUrl = '';
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url: string | URL | Request) => {
        fetchedUrl = requestUrlOf(url);
        return jsonResponse({ bindings: [] }, 200);
      });
    try {
      const result = await executeGcpPlanSteps({
        steps: [
          {
            method: 'POST',
            url: 'https://cloudresourcemanager.googleapis.com/v1%2Fprojects%2Fp%3AgetIamPolicy',
            body: {},
            purpose: 'read policy',
          },
        ],
        accessToken: 'token',
        expectedProjectId: 'p',
      });
      expect(result.error).toBeUndefined();
      expect(fetchedUrl).toMatch(/\/v3\/projects\//);
      expect(fetchedUrl).not.toMatch(/v1/);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('upgrades encoded CRM v1 getIamPolicy reads to v3 with policy version 3', async () => {
    let fetchedUrl = '';
    let sentBody: Record<string, unknown> = {};
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async (url: string | URL | Request, init?: RequestInit) => {
          fetchedUrl = requestUrlOf(url);
          const rawBody = init?.body;
          const bodyText = typeof rawBody === 'string' ? rawBody : '{}';
          try {
            sentBody = JSON.parse(bodyText) as Record<string, unknown>;
          } catch {
            sentBody = {};
          }
          return jsonResponse({ bindings: [] }, 200);
        },
      );
    try {
      const result = await executeGcpPlanSteps({
        steps: [
          {
            method: 'POST',
            url: 'https://cloudresourcemanager.googleapis.com/v1/projects/p%3AgetIamPolicy',
            body: {},
            purpose: 'read policy',
          },
        ],
        accessToken: 'token',
        expectedProjectId: 'p',
      });
      expect(result.error).toBeUndefined();
      // Same decoded action the guards see — encoded or not.
      expect(fetchedUrl).toMatch(/\/v3\/projects\//);
      expect(decodeURIComponent(fetchedUrl)).toMatch(/:getIamPolicy/);
      expect(sentBody).toEqual({ options: { requestedPolicyVersion: 3 } });
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe('sanitizeGcpErrorForLog', () => {
  it('redacts member emails from server error text', () => {
    const redacted = sanitizeGcpErrorForLog(
      'GCP API error (403): user:alice@example.com does not have access; serviceAccount:sa@proj.iam.gserviceaccount.com missing role',
    );
    expect(redacted).not.toMatch(/alice@example\.com/);
    expect(redacted).not.toMatch(/sa@proj\.iam\.gserviceaccount\.com/);
    expect(redacted).toMatch(/\[redacted-email\]/);
  });

  it('collapses newlines and bounds length', () => {
    const redacted = sanitizeGcpErrorForLog(
      `line one\nline two\r\nline three ${'x'.repeat(600)}`,
    );
    expect(redacted).not.toMatch(/[\r\n]/);
    expect(redacted.length).toBeLessThanOrEqual(500);
  });
});
