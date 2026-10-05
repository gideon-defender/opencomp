import type { GcpFixPlan } from './gcp-ai-remediation.prompt';
import {
  assertAcknowledgedPlanHash,
  hashGcpPlanSteps,
} from './gcp-remediation-plan.utils';
import { stableJsonStringify } from './remediation-stable-json';
import {
  buildPreviewResponse,
  guidedOnlyForInvalidPlan,
  validateFixPlan,
  validatedRollbackSteps,
} from './gcp-remediation-plan-guards';

const BUCKET = 'https://storage.googleapis.com/storage/v1/b/my-bucket';

const BASE_PLAN: GcpFixPlan = {
  canAutoFix: true,
  risk: 'low',
  description: 'remove public access',
  currentState: {},
  proposedState: {},
  readSteps: [{ method: 'GET', url: BUCKET, purpose: 'read bucket' }],
  fixSteps: [
    {
      method: 'PATCH',
      url: BUCKET,
      body: { iamConfiguration: {} },
      purpose: 'fix',
    },
  ],
  rollbackSteps: [],
  rollbackSupported: false,
  requiresAcknowledgment: true,
};

const logger = { warn: jest.fn() };

const BINDING = {
  organizationId: 'org_1',
  connectionId: 'conn_gcp',
  checkResultId: 'chk_1',
  remediationKey: 'fix',
};

beforeEach(() => {
  logger.warn.mockClear();
});

describe('assertAcknowledgedPlanHash', () => {
  it('passes when the hash matches the steps', () => {
    expect(() =>
      assertAcknowledgedPlanHash({
        binding: BINDING,
        expectedPlanHash: hashGcpPlanSteps(BASE_PLAN.fixSteps, [], BINDING),
        fixSteps: BASE_PLAN.fixSteps,
      }),
    ).not.toThrow();
  });

  it('is a no-op when the client sent no hash', () => {
    expect(() =>
      assertAcknowledgedPlanHash({
        binding: BINDING,
        expectedPlanHash: undefined,
        fixSteps: BASE_PLAN.fixSteps,
      }),
    ).not.toThrow();
  });

  it('refuses when the steps changed since acknowledgment', () => {
    expect(() =>
      assertAcknowledgedPlanHash({
        binding: BINDING,
        expectedPlanHash: hashGcpPlanSteps(BASE_PLAN.fixSteps, [], BINDING),
        fixSteps: [
          ...BASE_PLAN.fixSteps,
          {
            method: 'PATCH',
            url: BUCKET,
            body: { iamConfiguration: {} },
            purpose: 'extra',
          },
        ],
      }),
    ).toThrow(/previewed plan changed/);
  });

  it('refuses a hash previewed for another finding with identical steps', () => {
    // Same project, same generic fix shape: without the finding binding,
    // the two hashes collide and finding B runs on finding A's approval.
    const otherFinding = { ...BINDING, checkResultId: 'chk_2' };
    const acknowledged = hashGcpPlanSteps(BASE_PLAN.fixSteps, [], BINDING);
    expect(acknowledged).not.toBe(
      hashGcpPlanSteps(BASE_PLAN.fixSteps, [], otherFinding),
    );
    expect(() =>
      assertAcknowledgedPlanHash({
        binding: otherFinding,
        expectedPlanHash: acknowledged,
        fixSteps: BASE_PLAN.fixSteps,
      }),
    ).toThrow(/previewed plan changed/);
  });

  it('hashes plans independent of key order', () => {
    const reordered = [
      {
        method: 'PATCH',
        url: BUCKET,
        queryParams: { updateMask: 'a', predefinedAcl: 'b' },
        body: { b: 1, a: { y: 2, x: 1 } },
        purpose: 'fix',
      },
    ];
    const ordered = [
      {
        method: 'PATCH',
        url: BUCKET,
        queryParams: { predefinedAcl: 'b', updateMask: 'a' },
        body: { a: { x: 1, y: 2 }, b: 1 },
        purpose: 'fix',
      },
    ];
    expect(hashGcpPlanSteps(reordered, [], BINDING)).toBe(
      hashGcpPlanSteps(ordered, [], BINDING),
    );
  });

  it('stableJsonStringify sorts keys recursively and keeps array order', () => {
    expect(stableJsonStringify({ b: 1, a: { y: 2, x: 1 } })).toBe(
      '{"a":{"x":1,"y":2},"b":1}',
    );
    expect(stableJsonStringify([{ b: 1, a: 1 }])).toBe('[{"a":1,"b":1}]');
  });

  it('stableJsonStringify keeps __proto__ keys so mutated plans hash differently', () => {
    // JSON.parse creates __proto__ as an own key; a plain-object
    // accumulator would set the prototype and stringify would drop it,
    // letting a mutated plan pass the acknowledgment binding.
    const mutated = JSON.parse('{"body":{"__proto__":{"polluted":true}}}');
    const clean = { body: {} };
    expect(stableJsonStringify(mutated)).not.toBe(stableJsonStringify(clean));
    expect(stableJsonStringify(mutated)).toContain('__proto__');
  });
});

describe('validateFixPlan', () => {
  it('refuses an empty fix plan', () => {
    expect(
      validateFixPlan(
        { ...BASE_PLAN, fixSteps: [] },
        { assetClass: 'Storage' },
      ),
    ).toEqual(['AI generated an empty fix plan — refused for safety']);
  });
});

describe('validatedRollbackSteps', () => {
  it('returns empty without a reason when the plan carries none', () => {
    expect(validatedRollbackSteps({ plan: BASE_PLAN, logger })).toEqual({
      steps: [],
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('keeps a rollback that validates', () => {
    const rollback = {
      method: 'PATCH' as const,
      url: BUCKET,
      body: { iamConfiguration: {} },
      queryParams: { updateMask: 'iamConfiguration' },
      purpose: 'restore bucket',
    };
    const result = validatedRollbackSteps({
      plan: { ...BASE_PLAN, rollbackSteps: [rollback] },
      previousState: { 'read bucket': { iamConfiguration: {} } },
      assetClass: 'Storage',
      readSteps: [{ purpose: 'read bucket', url: BUCKET }],
      expectedBucket: 'my-bucket',
      logger,
    });
    expect(result.steps).toEqual([rollback]);
    expect(result.droppedReason).toBeUndefined();
  });

  it('drops a non-allowlisted rollback with a reason', () => {
    const result = validatedRollbackSteps({
      plan: {
        ...BASE_PLAN,
        rollbackSteps: [
          {
            method: 'DELETE' as const,
            url: 'https://evil.example/steal',
            purpose: 'rollback',
          },
        ],
      },
      assetClass: 'Storage',
      logger,
    });
    expect(result.steps).toEqual([]);
    expect(result.droppedReason).toMatch(/non-allowlisted/);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('drops a rollback outside every fix resource with a reason', () => {
    const result = validatedRollbackSteps({
      plan: {
        ...BASE_PLAN,
        rollbackSteps: [
          {
            method: 'POST' as const,
            url: 'https://storage.googleapis.com/storage/v1/b/other-bucket',
            body: { name: 'other-bucket' },
            purpose: 'rollback',
          },
        ],
      },
      assetClass: 'Storage',
      readSteps: [{ purpose: 'read bucket', url: BUCKET }],
      logger,
    });
    expect(result.steps).toEqual([]);
    expect(result.droppedReason).toMatch(/auto-rollback/);
  });
});

describe('guidedOnlyForInvalidPlan', () => {
  it('names the first error and drops rollback support', () => {
    const response = guidedOnlyForInvalidPlan(BASE_PLAN, ['boom']);
    expect(response).toMatchObject({
      guidedOnly: true,
      rollbackSupported: false,
    });
    expect((response.guidedSteps as string[])[0]).toMatch(
      /Automatic fix is unavailable.*boom/,
    );
  });
});

describe('buildPreviewResponse', () => {
  it('does not advertise a dropped rollback', () => {
    const response = buildPreviewResponse({
      binding: BINDING,
      plan: {
        ...BASE_PLAN,
        rollbackSupported: true,
        rollbackSteps: [
          {
            method: 'POST' as const,
            url: 'https://storage.googleapis.com/storage/v1/b/other-bucket',
            body: { name: 'other-bucket' },
            purpose: 'rollback',
          },
        ],
      },
      assetClass: 'Storage',
      stateReadSteps: [{ purpose: 'read bucket', url: BUCKET }],
      logger,
    });
    expect(response.rollbackSupported).toBe(false);
    expect(response.guidedOnly).toBe(false);
  });

  it('advertises a rollback that validates', () => {
    const rollback = {
      method: 'PATCH' as const,
      url: BUCKET,
      body: { iamConfiguration: {} },
      queryParams: { updateMask: 'iamConfiguration' },
      purpose: 'restore bucket',
    };
    const response = buildPreviewResponse({
      binding: BINDING,
      plan: {
        ...BASE_PLAN,
        rollbackSupported: true,
        rollbackSteps: [rollback],
      },
      realState: { 'read bucket': { iamConfiguration: {} } },
      assetClass: 'Storage',
      stateReadSteps: [{ purpose: 'read bucket', url: BUCKET }],
      expectedBucket: 'my-bucket',
      logger,
    });
    expect(response.rollbackSupported).toBe(true);
  });
});

describe('acknowledged rollback binding', () => {
  const rollback = {
    method: 'PATCH' as const,
    url: BUCKET,
    queryParams: { updateMask: 'iamConfiguration' },
    body: { iamConfiguration: {} },
    purpose: 'restore',
  };

  it('hashes rollback steps with fix steps', () => {
    expect(hashGcpPlanSteps(BASE_PLAN.fixSteps, [rollback], BINDING)).not.toBe(
      hashGcpPlanSteps(BASE_PLAN.fixSteps, [], BINDING),
    );
    expect(hashGcpPlanSteps(BASE_PLAN.fixSteps, [], BINDING)).toBe(
      hashGcpPlanSteps(BASE_PLAN.fixSteps, [], BINDING),
    );
  });

  it('refuses when the rollback changed since acknowledgment', () => {
    const acknowledged = hashGcpPlanSteps(
      BASE_PLAN.fixSteps,
      [rollback],
      BINDING,
    );
    expect(() =>
      assertAcknowledgedPlanHash({
        binding: BINDING,
        expectedPlanHash: acknowledged,
        fixSteps: BASE_PLAN.fixSteps,
        rollbackSteps: [
          {
            ...rollback,
            body: { iamConfiguration: { swapped: true } },
          },
        ],
      }),
    ).toThrow(/previewed plan changed/);
  });

  it('accepts the acknowledged rollback set', () => {
    const acknowledged = hashGcpPlanSteps(
      BASE_PLAN.fixSteps,
      [rollback],
      BINDING,
    );
    expect(() =>
      assertAcknowledgedPlanHash({
        binding: BINDING,
        expectedPlanHash: acknowledged,
        fixSteps: BASE_PLAN.fixSteps,
        rollbackSteps: [rollback],
      }),
    ).not.toThrow();
  });
});
