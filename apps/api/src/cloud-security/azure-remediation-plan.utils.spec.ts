import {
  assertAcknowledgedPlanHash,
  assertAzureRetryBodiesPinned,
  assertAzureRetryTargetsPinned,
  hashAzurePlanSteps,
} from './azure-remediation-plan.utils';

const BINDING = {
  organizationId: 'org_1',
  connectionId: 'conn_1',
  checkResultId: 'chk_1',
  remediationKey: 'k',
};

const FIX = [
  {
    method: 'PATCH',
    url: 'https://management.azure.com/subscriptions/s/rg/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01',
    body: { properties: { supportsHttpsTrafficOnly: true } },
    purpose: 'fix',
  },
];

describe('hashAzurePlanSteps', () => {
  it('is stable across key order and prefixed', () => {
    const reordered = [
      {
        purpose: 'fix',
        body: { properties: { supportsHttpsTrafficOnly: true } },
        url: FIX[0]?.url,
        method: 'PATCH',
      },
    ];
    expect(hashAzurePlanSteps(FIX, [], BINDING)).toBe(
      hashAzurePlanSteps(reordered, [], BINDING),
    );
    expect(hashAzurePlanSteps(FIX, [], BINDING)).toMatch(
      /^azure-[0-9a-f]{64}$/,
    );
  });

  it('ignores purpose rewording but binds rollback and finding', () => {
    const reworded = [{ ...FIX[0], purpose: 'different words' }];
    expect(hashAzurePlanSteps(reworded, [], BINDING)).toBe(
      hashAzurePlanSteps(FIX, [], BINDING),
    );
    expect(hashAzurePlanSteps(FIX, FIX, BINDING)).not.toBe(
      hashAzurePlanSteps(FIX, [], BINDING),
    );
    expect(
      hashAzurePlanSteps(FIX, [], { ...BINDING, checkResultId: 'other' }),
    ).not.toBe(hashAzurePlanSteps(FIX, [], BINDING));
  });

  it('binds query params: api-version changes the hash', () => {
    const reversioned = [
      { ...FIX[0], queryParams: { 'api-version': '2021-01-01' } },
    ];
    expect(hashAzurePlanSteps(reversioned, [], BINDING)).not.toBe(
      hashAzurePlanSteps(FIX, [], BINDING),
    );
  });
});

describe('assertAcknowledgedPlanHash', () => {
  it('passes on match and on absent expectation', () => {
    const hash = hashAzurePlanSteps(FIX, [], BINDING);
    expect(() =>
      assertAcknowledgedPlanHash({
        expectedPlanHash: hash,
        binding: BINDING,
        fixSteps: FIX,
      }),
    ).not.toThrow();
    expect(() =>
      assertAcknowledgedPlanHash({
        expectedPlanHash: undefined,
        binding: BINDING,
        fixSteps: FIX,
      }),
    ).not.toThrow();
  });

  it('throws when the plan changed', () => {
    expect(() =>
      assertAcknowledgedPlanHash({
        expectedPlanHash: 'azure-deadbeef',
        binding: BINDING,
        fixSteps: FIX,
      }),
    ).toThrow(/changed since you acknowledged it/);
  });
});

describe('assertAzureRetryTargetsPinned', () => {
  it('allows new bodies on identical targets', () => {
    const retry = [
      {
        ...FIX[0],
        body: { properties: { supportsHttpsTrafficOnly: true, extra: 1 } },
      },
    ];
    expect(() =>
      assertAzureRetryTargetsPinned({
        currentFixSteps: FIX,
        retryFixSteps: retry,
      }),
    ).not.toThrow();
  });

  it('refuses drifted targets and reordered steps', () => {
    const base = FIX[0];
    const drifted = [
      {
        ...base,
        url: base.url.replace('/sa?', '/other?'),
      },
    ];
    expect(() =>
      assertAzureRetryTargetsPinned({
        currentFixSteps: FIX,
        retryFixSteps: drifted,
      }),
    ).toThrow(/different resources/);
    expect(() =>
      assertAzureRetryTargetsPinned({
        currentFixSteps: [...FIX, ...FIX],
        retryFixSteps: [FIX[0]],
      }),
    ).toThrow(/different resources/);
  });

  it('refuses retries drifting across subscriptions or resource groups', () => {
    const base = FIX[0];
    const otherSub = [
      {
        ...base,
        url: base.url.replace('/subscriptions/s/', '/subscriptions/t/'),
      },
    ];
    expect(() =>
      assertAzureRetryTargetsPinned({
        currentFixSteps: FIX,
        retryFixSteps: otherSub,
      }),
    ).toThrow(/different resources/);
    // Same provider path, different resource group: still a new plan.
    const otherRg = [
      {
        ...base,
        url: 'https://management.azure.com/subscriptions/s/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01',
      },
    ];
    const sameRg = [
      {
        ...base,
        url: 'https://management.azure.com/subscriptions/s/resourceGroups/other/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01',
      },
    ];
    expect(() =>
      assertAzureRetryTargetsPinned({
        currentFixSteps: otherRg,
        retryFixSteps: sameRg,
      }),
    ).toThrow(/different resources/);
    // Identical scope still pins.
    expect(() =>
      assertAzureRetryTargetsPinned({
        currentFixSteps: otherRg,
        retryFixSteps: otherRg,
      }),
    ).not.toThrow();
  });

  it('pins query params: an api-version swap is a new plan', () => {
    const reversioned = [
      { ...FIX[0], queryParams: { 'api-version': '2021-01-01' } },
    ];
    expect(() =>
      assertAzureRetryTargetsPinned({
        currentFixSteps: FIX,
        retryFixSteps: reversioned,
      }),
    ).toThrow(/different resources/);
  });

  it('pins embedded query: an api-version swap inside url is a new plan', () => {
    const base = FIX[0];
    const reversioned = [
      {
        ...base,
        url: base.url.replace('api-version=2023-05-01', 'api-version=2021-01-01'),
      },
    ];
    expect(() =>
      assertAzureRetryTargetsPinned({
        currentFixSteps: FIX,
        retryFixSteps: reversioned,
      }),
    ).toThrow(/different resources/);
  });
});

describe('assertAzureRetryBodiesPinned', () => {
  it('allows corrected values inside previewed fields', () => {
    const retry = [
      {
        ...FIX[0],
        body: { properties: { supportsHttpsTrafficOnly: false } },
      },
    ];
    expect(() =>
      assertAzureRetryBodiesPinned({
        currentFixSteps: FIX,
        retryFixSteps: retry,
      }),
    ).not.toThrow();
  });

  it('refuses new top-level fields the acknowledged plan never wrote', () => {
    const retry = [
      {
        ...FIX[0],
        body: {
          properties: { supportsHttpsTrafficOnly: true },
          tags: { env: 'prod' },
        },
      },
    ];
    expect(() =>
      assertAzureRetryBodiesPinned({
        currentFixSteps: FIX,
        retryFixSteps: retry,
      }),
    ).toThrow(/new fields \(tags\.env\)/);
  });

  it('refuses a body added where the acknowledged step had none', () => {
    const bare = [{ ...FIX[0], body: undefined }];
    expect(() =>
      assertAzureRetryBodiesPinned({
        currentFixSteps: bare,
        retryFixSteps: FIX,
      }),
    ).toThrow(/new fields/);
  });

  it('refuses misaligned step lists', () => {
    expect(() =>
      assertAzureRetryBodiesPinned({
        currentFixSteps: FIX,
        retryFixSteps: [...FIX, ...FIX],
      }),
    ).toThrow(/different resources/);
  });

  it('refuses new nested fields inside a previewed object', () => {
    const retry = [
      {
        ...FIX[0],
        body: {
          properties: {
            supportsHttpsTrafficOnly: true,
            allowBlobPublicAccess: true,
          },
        },
      },
    ];
    expect(() =>
      assertAzureRetryBodiesPinned({
        currentFixSteps: FIX,
        retryFixSteps: retry,
      }),
    ).toThrow(/new fields \(properties\.allowBlobPublicAccess\)/);
  });

  it('refuses scalar-to-object expansion the acknowledged plan never wrote', () => {
    const current = [{ ...FIX[0], body: { properties: { mode: 'a' } } }];
    const retry = [
      { ...FIX[0], body: { properties: { mode: { sub: 'b' } } } },
    ];
    expect(() =>
      assertAzureRetryBodiesPinned({
        currentFixSteps: current,
        retryFixSteps: retry,
      }),
    ).toThrow(/new fields \(properties\.mode\.sub\)/);
  });

  it('refuses new array elements the acknowledged plan never wrote', () => {
    const current = [
      {
        ...FIX[0],
        body: { properties: { logs: [{ category: 'Audit', enabled: true }] } },
      },
    ];
    const retry = [
      {
        ...FIX[0],
        body: {
          properties: {
            logs: [
              { category: 'Audit', enabled: true },
              { category: 'Security', enabled: false },
            ],
          },
        },
      },
    ];
    expect(() =>
      assertAzureRetryBodiesPinned({
        currentFixSteps: current,
        retryFixSteps: retry,
      }),
    ).toThrow(/new fields/);
  });
});
