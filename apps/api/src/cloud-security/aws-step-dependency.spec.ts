import {
  looksLikeMissingDependencyError,
  sharesResourceIdentifier,
} from './aws-step-dependency';

// Unit tests for the step-dependency helpers (split out of
// aws-command-executor.spec.ts alongside the implementation). Integration
// coverage of the post-no-op skip lives with executePlanSteps.

it('classifies missing-dependency shapes narrowly', () => {
  expect(
    looksLikeMissingDependencyError(
      'NoSuchBucket: the specified bucket does not exist',
    ),
  ).toBe(true);
  expect(
    looksLikeMissingDependencyError('ResourceNotFoundException: not found'),
  ).toBe(true);
  expect(
    looksLikeMissingDependencyError(
      'Invalid parameter: Bucket must be a valid bucket name',
    ),
  ).toBe(false);
  expect(
    looksLikeMissingDependencyError('Missing required parameter: Bucket'),
  ).toBe(false);
});

describe('sharesResourceIdentifier', () => {
  it('matches on shared identifier keys and ignores status flags', () => {
    expect(
      sharesResourceIdentifier(
        {
          Bucket: 'owned-bucket',
          VersioningConfiguration: { Status: 'Enabled' },
        },
        {
          Bucket: 'owned-bucket',
          VersioningConfiguration: { Status: 'Suspended' },
        },
      ),
    ).toBe(true);
  });

  it('rejects steps that only share a status flag', () => {
    expect(
      sharesResourceIdentifier(
        {
          Bucket: 'owned-bucket',
          VersioningConfiguration: { Status: 'Enabled' },
        },
        {
          Bucket: 'other-bucket',
          VersioningConfiguration: { Status: 'Enabled' },
        },
      ),
    ).toBe(false);
  });

  it('matches nested identifiers like LogGroupName', () => {
    expect(
      sharesResourceIdentifier(
        { logGroupName: '/aws/app' },
        {
          logGroupName: '/aws/app',
          filterName: 'errors',
          filterPattern: 'ERROR',
        },
      ),
    ).toBe(true);
  });

  it('returns false when the prior step names nothing usable', () => {
    expect(
      sharesResourceIdentifier({ Status: 'Enabled' }, { Status: 'Enabled' }),
    ).toBe(false);
    expect(sharesResourceIdentifier({}, { Bucket: 'b' })).toBe(false);
  });
});
