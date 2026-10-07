import { azureFixWrittenPathsByPurpose } from './azure-remediation-verify-paths';
import { isFixVerifiedByState } from './azure-remediation-plan.utils';

describe('isFixVerifiedByState', () => {
  it('verifies when the re-read differs from the captured state', () => {
    expect(
      isFixVerifiedByState({
        previousState: { fix: { enabled: false } },
        postFixState: { fix: { enabled: true } },
      }),
    ).toBe(true);
  });

  it('is insensitive to key order', () => {
    expect(
      isFixVerifiedByState({
        previousState: { fix: { a: 1, b: 2 } },
        postFixState: { fix: { b: 2, a: 1 } },
      }),
    ).toBe(false);
  });

  it('reads an empty post-state as unverified, never as changed', () => {
    expect(
      isFixVerifiedByState({
        previousState: { fix: { enabled: false } },
        postFixState: {},
      }),
    ).toBe(false);
  });

  it('reads a missing before-state as unverified', () => {
    expect(
      isFixVerifiedByState({
        previousState: {},
        postFixState: { fix: { enabled: true } },
      }),
    ).toBe(false);
  });

  it('ignores drift on paths the fix never wrote when writtenPaths are given', () => {
    expect(
      isFixVerifiedByState({
        previousState: { fix: { properties: { enabled: false }, etag: '"1"' } },
        postFixState: { fix: { properties: { enabled: false }, etag: '"2"' } },
        writtenPaths: ['properties.enabled'],
      }),
    ).toBe(false);
  });

  it('verifies a change on a written path when writtenPaths are given', () => {
    expect(
      isFixVerifiedByState({
        previousState: { fix: { properties: { enabled: false } } },
        postFixState: { fix: { properties: { enabled: true } } },
        writtenPaths: ['properties.enabled'],
      }),
    ).toBe(true);
  });

  it('verifies without writtenPaths on any change (legacy)', () => {
    expect(
      isFixVerifiedByState({
        previousState: { fix: { etag: '"1"' } },
        postFixState: { fix: { etag: '"2"' } },
      }),
    ).toBe(true);
  });

  it('never lets drift in one entry verify a fix written to another', () => {
    // Both entries share the relative path `properties.enabled`; only
    // entry `a` carries the fix's writes. A change in `b` alone must
    // not verify.
    const previous = {
      a: { properties: { enabled: false } },
      b: { properties: { enabled: false } },
    };
    expect(
      isFixVerifiedByState({
        previousState: previous,
        postFixState: {
          a: { properties: { enabled: false } },
          b: { properties: { enabled: true } },
        },
        writtenPathsByPurpose: { a: ['properties.enabled'] },
      }),
    ).toBe(false);
    expect(
      isFixVerifiedByState({
        previousState: previous,
        postFixState: {
          a: { properties: { enabled: true } },
          b: { properties: { enabled: false } },
        },
        writtenPathsByPurpose: { a: ['properties.enabled'] },
      }),
    ).toBe(true);
  });

  it('ignores purposes missing from either state', () => {
    // Refinement can rename purposes between reads: a key with no
    // counterpart is incomparable, never proof.
    expect(
      isFixVerifiedByState({
        previousState: { a: { v: 1 } },
        postFixState: { b: { v: 2 } },
        writtenPathsByPurpose: { a: ['v'], b: ['v'] },
      }),
    ).toBe(false);
  });

  it('reads whole-entry scalar changes as unverified', () => {
    // A scalar entry names no attributable path: fail safe.
    expect(
      isFixVerifiedByState({
        previousState: { a: 'before' },
        postFixState: { a: 'after' },
        writtenPathsByPurpose: { a: ['a'] },
      }),
    ).toBe(false);
  });
});

describe('azureFixWrittenPathsByPurpose', () => {
  const READ = {
    url: 'https://management.azure.com/subscriptions/s/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa?api-version=2023-05-01',
    purpose: 'read-account',
  };

  it('attributes fix paths to the read purpose on the same resource', () => {
    expect(
      azureFixWrittenPathsByPurpose({
        fixSteps: [
          {
            url: READ.url,
            body: { properties: { supportsHttpsTrafficOnly: true } },
          },
        ],
        readSteps: [READ],
      }),
    ).toEqual({
      'read-account': ['properties.supportsHttpsTrafficOnly'],
    });
  });

  it('attributes sub-resource writes to the parent re-read', () => {
    // An NSG rule PUT verifies against its parent NSG re-read.
    expect(
      azureFixWrittenPathsByPurpose({
        fixSteps: [
          {
            url: `${READ.url.split('?')[0]}/blobServices/default`,
            body: { properties: { deleteRetentionPolicy: { enabled: true } } },
          },
        ],
        readSteps: [READ],
      }),
    ).toEqual({
      'read-account': ['properties.deleteRetentionPolicy.enabled'],
    });
  });

  it('ignores api-version differences when matching resources', () => {
    expect(
      azureFixWrittenPathsByPurpose({
        fixSteps: [
          {
            url: READ.url.replace('2023-05-01', '2024-01-01'),
            body: { properties: { x: 1 } },
          },
        ],
        readSteps: [READ],
      }),
    ).toEqual({ 'read-account': ['properties.x'] });
  });

  it('leaves fixes with no read coverage unattributed', () => {
    expect(
      azureFixWrittenPathsByPurpose({
        fixSteps: [{ url: READ.url, body: { properties: { x: 1 } } }],
        readSteps: [],
      }),
    ).toEqual({});
  });
});
