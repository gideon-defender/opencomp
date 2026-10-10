import assert from 'node:assert/strict';

export function validateRelease({ version, packageVersion, accepted, prereleaseApproved }) {
  assert.equal(version, packageVersion, 'Set an explicit package version before publishing');
  assert(
    typeof version === 'string' &&
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-next\.(0|[1-9]\d*))?$/.test(version),
    'Use a stable version or X.Y.Z-next.N',
  );
  if (!version.includes('-'))
    assert(accepted === true, 'Phase 5 cutover acceptance is required before publishing');
  else
    assert(
      prereleaseApproved === true,
      'Explicit prerelease approval is required before publishing',
    );
  return version.includes('-') ? 'next' : 'latest';
}

export function decidePublication({ version, fingerprint, binarySha256, existing, prerelease }) {
  if (existing) {
    assert.equal(
      existing.opencompRelease?.sourceSha256,
      fingerprint,
      'An existing version has different contents; never overwrite or silently accept it',
    );
    assert.equal(
      existing.opencompRelease?.binarySha256,
      binarySha256,
      'An existing version has different binary contents; refusing to skip',
    );
    return 'skip';
  }
  if (!version.includes('-')) {
    const base = version.split('-')[0];
    assert(
      prerelease?.version?.startsWith(`${base}-next.`),
      'Stable publishing requires a tested next prerelease of this version',
    );
    assert.equal(
      prerelease.opencompRelease?.sourceSha256,
      fingerprint,
      'The tested prerelease must use the exact same source, spec, overlay and lockfile',
    );
  }
  return 'publish';
}
