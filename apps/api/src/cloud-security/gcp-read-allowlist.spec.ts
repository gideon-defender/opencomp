import { isGcpReadAllowedUrl, isGcpReadOnlyMethod } from './gcp-read-allowlist';

describe('isGcpReadAllowedUrl', () => {
  it('allows fix and extra read hosts over HTTPS', () => {
    expect(
      isGcpReadAllowedUrl(
        'https://storage.googleapis.com/storage/v1/b/my-bucket',
      ),
    ).toBe(true);
    expect(
      isGcpReadAllowedUrl(
        'https://cloudresourcemanager.googleapis.com/v3/projects/p:getIamPolicy',
      ),
    ).toBe(true);
  });

  it('matches hosts case-insensitively', () => {
    expect(
      isGcpReadAllowedUrl(
        'https://STORAGE.GOOGLEAPIS.COM/storage/v1/b/my-bucket',
      ),
    ).toBe(true);
  });

  it('refuses plaintext, foreign, and unparseable URLs', () => {
    expect(
      isGcpReadAllowedUrl(
        'http://storage.googleapis.com/storage/v1/b/my-bucket',
      ),
    ).toBe(false);
    expect(isGcpReadAllowedUrl('https://example.com/v1/x')).toBe(false);
    expect(
      isGcpReadAllowedUrl('https://storage.googleapis.com.evil.com/v1/x'),
    ).toBe(false);
    expect(isGcpReadAllowedUrl('not-a-url')).toBe(false);
  });
});

describe('isGcpReadOnlyMethod', () => {
  it('accepts GET anywhere and POST only for :getIamPolicy', () => {
    expect(
      isGcpReadOnlyMethod({
        method: 'GET',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
      }),
    ).toBe(true);
    expect(
      isGcpReadOnlyMethod({
        method: 'POST',
        url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p:getIamPolicy',
      }),
    ).toBe(true);
    expect(
      isGcpReadOnlyMethod({
        method: 'POST',
        url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p:setIamPolicy',
      }),
    ).toBe(false);
    expect(
      isGcpReadOnlyMethod({
        method: 'PUT',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
      }),
    ).toBe(false);
  });

  it('decodes actions to a fixed point like every other guard', () => {
    expect(
      isGcpReadOnlyMethod({
        method: 'POST',
        url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p%3AgetIamPolicy',
      }),
    ).toBe(true);
    // Double-encoding reads as IAM here exactly as it does in the
    // allowlist normalizer and the IAM matchers: guards must agree on
    // what a path means, or a read one guard calls IAM is refused by
    // another. Undecodable paths still fail closed.
    expect(
      isGcpReadOnlyMethod({
        method: 'POST',
        url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p%253AgetIamPolicy',
      }),
    ).toBe(true);
    expect(
      isGcpReadOnlyMethod({
        method: 'POST',
        url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p%ZZ:getIamPolicy',
      }),
    ).toBe(false);
  });

  it('treats a trailing-slash :getIamPolicy like the canonical matcher', () => {
    // `isGetIamPolicyUrl` strips trailing slashes before matching — this
    // gate must agree, or a `...:getIamPolicy/` read is refused here but
    // upgraded and executed as the same IAM read elsewhere.
    expect(
      isGcpReadOnlyMethod({
        method: 'POST',
        url: 'https://cloudresourcemanager.googleapis.com/v3/projects/p:getIamPolicy/',
      }),
    ).toBe(true);
  });
});
