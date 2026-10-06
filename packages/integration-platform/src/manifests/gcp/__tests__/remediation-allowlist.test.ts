import { describe, expect, it } from 'vitest';
import {
  GCP_NEVER_ALLOW_PERMISSIONS,
  GCP_NEVER_ALLOW_ROLES,
  decodeGcpPathnameToFixedPoint,
  gcpRollbackDeletePrefixAllowed,
  isGcpAllowlistedFixStep,
  splitGcpPathSegments,
} from '../remediation-allowlist';

describe('shared URL canonicalizers', () => {
  it('decodes single and double encoding to a fixed point', () => {
    expect(decodeGcpPathnameToFixedPoint('/b/%6F')).toBe('/b/o');
    expect(decodeGcpPathnameToFixedPoint('/b/%256F')).toBe('/b/o');
    expect(decodeGcpPathnameToFixedPoint('/b/plain')).toBe('/b/plain');
  });

  it('fails closed on undecodable paths', () => {
    expect(decodeGcpPathnameToFixedPoint('/b/%ZZ')).toBeUndefined();
  });

  it('resolves dot-segments the way the server routes them', () => {
    expect(splitGcpPathSegments('/a/b/../c')).toEqual(['a', 'c']);
    expect(splitGcpPathSegments('/a/./b')).toEqual(['a', 'b']);
    expect(splitGcpPathSegments('/a//b')).toEqual(['a', 'b']);
  });
});

describe('isGcpAllowlistedFixStep', () => {
  it('allows exact class-prefix method pairs', () => {
    expect(
      isGcpAllowlistedFixStep({
        assetClass: 'Storage',
        method: 'PATCH',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
      }),
    ).toBe(true);
  });

  it('refuses cross-class hosts and wrong methods', () => {
    expect(
      isGcpAllowlistedFixStep({
        assetClass: 'Storage',
        method: 'PATCH',
        url: 'https://compute.googleapis.com/compute/v1/projects/p/zones/z/instances/i',
      }),
    ).toBe(false);
    expect(
      isGcpAllowlistedFixStep({
        assetClass: 'Storage',
        method: 'DELETE',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
      }),
    ).toBe(false);
  });

  it('refuses dot-segment escapes outside the prefix', () => {
    expect(
      isGcpAllowlistedFixStep({
        assetClass: 'Storage',
        method: 'PATCH',
        url: 'https://storage.googleapis.com/storage/v1/b/x/../../compute/v1/projects/p/y',
      }),
    ).toBe(false);
  });

  it('refuses double-encoded traversal outside the prefix', () => {
    // Two encoded `..` levels: from `/b/x/` they climb past `/b/` to
    // `/storage/v1/`, outside the Storage prefix. (A single level would
    // legitimately resolve inside `/b/` — same as the raw `..` case above,
    // which also climbs two levels.)
    expect(
      isGcpAllowlistedFixStep({
        assetClass: 'Storage',
        method: 'PATCH',
        url: 'https://storage.googleapis.com/storage/v1/b/x/%252e%252e/%252e%252e/compute/v1/projects/p/y',
      }),
    ).toBe(false);
  });

  it('refuses plaintext schemes and port-shifted hosts', () => {
    expect(
      isGcpAllowlistedFixStep({
        assetClass: 'Storage',
        method: 'PATCH',
        url: 'http://storage.googleapis.com/storage/v1/b/my-bucket',
      }),
    ).toBe(false);
    expect(
      isGcpAllowlistedFixStep({
        assetClass: 'Storage',
        method: 'PATCH',
        url: 'https://storage.googleapis.com:8443/storage/v1/b/my-bucket',
      }),
    ).toBe(false);
  });

  it('refuses off-Google and suffix-sibling hosts', () => {
    expect(
      isGcpAllowlistedFixStep({
        assetClass: 'Storage',
        method: 'PATCH',
        url: 'https://storage.googleapis.com.evil.com/storage/v1/b/my-bucket',
      }),
    ).toBe(false);
    expect(
      isGcpAllowlistedFixStep({
        assetClass: 'Storage',
        method: 'PATCH',
        url: 'https://example.com/storage/v1/b/my-bucket',
      }),
    ).toBe(false);
  });

  it('refuses unparseable URLs', () => {
    expect(
      isGcpAllowlistedFixStep({
        assetClass: 'Storage',
        method: 'PATCH',
        url: 'not-a-url',
      }),
    ).toBe(false);
  });
});

describe('gcpRollbackDeletePrefixAllowed', () => {
  it('allows DELETE under the class prefixes, method ignored', () => {
    expect(
      gcpRollbackDeletePrefixAllowed({
        assetClass: 'Storage',
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket/o/obj',
      }),
    ).toBe(true);
    expect(
      gcpRollbackDeletePrefixAllowed({
        assetClass: 'Storage',
        url: 'https://compute.googleapis.com/compute/v1/projects/p/x',
      }),
    ).toBe(false);
  });

  it('refuses traversal and sibling hosts', () => {
    expect(
      gcpRollbackDeletePrefixAllowed({
        assetClass: 'Storage',
        url: 'https://storage.googleapis.com/storage/v1/b/x/../../compute/v1/projects/p/y',
      }),
    ).toBe(false);
    expect(
      gcpRollbackDeletePrefixAllowed({
        assetClass: 'Storage',
        url: 'https://storage.googleapis.com.evil.com/storage/v1/b/x',
      }),
    ).toBe(false);
  });
});

describe('never-allow backstops', () => {
  it('denies destructive and IAM-escalation permissions', () => {
    for (const permission of [
      'resourcemanager.projects.setIamPolicy',
      'iam.serviceAccounts.keys.create',
      'compute.instances.delete',
      'storage.buckets.delete',
    ]) {
      expect(GCP_NEVER_ALLOW_PERMISSIONS).toContain(permission);
    }
  });

  it('denies privileged, impersonation, and legacy dataset roles', () => {
    for (const role of [
      'roles/owner',
      'roles/editor',
      'roles/iam.serviceAccountTokenCreator',
      'roles/iam.serviceAccountUser',
      'roles/compute.admin',
      'roles/storage.admin',
      'OWNER',
      'WRITER',
    ]) {
      expect(GCP_NEVER_ALLOW_ROLES).toContain(role);
    }
  });
});
