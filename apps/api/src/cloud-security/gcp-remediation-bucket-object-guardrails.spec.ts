import { validateGcpStorageObjectUrl } from './gcp-remediation-bucket-object-guardrails';

function argsFor(
  pathname: string,
  method = 'PATCH',
  body: Record<string, unknown> = {},
) {
  return { pathname, method, body, prefix: 'test' };
}

describe('validateGcpStorageObjectUrl', () => {
  it('refuses object-level writes (not a bucket fix)', () => {
    const errors = validateGcpStorageObjectUrl(
      argsFor('/storage/v1/b/my-bucket/o/my-object'),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('object-level writes');
  });

  it('sees through dot-segment traversal to the object marker', () => {
    const errors = validateGcpStorageObjectUrl(
      argsFor('/storage/v1/b/victim/../my-bucket/o/my-object'),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('object-level writes');
  });

  it('refuses public ACL grants with the exposure named', () => {
    for (const entity of ['allUsers', 'allAuthenticatedUsers']) {
      const errors = validateGcpStorageObjectUrl(
        argsFor('/storage/v1/b/my-bucket/acl', 'PATCH', {
          entity,
          role: 'READER',
        }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('to the public (allUsers)');
    }
  });

  it('refuses OWNER grants on ACL endpoints', () => {
    const errors = validateGcpStorageObjectUrl(
      argsFor('/storage/v1/b/my-bucket/acl', 'PATCH', {
        entity: 'user-someone',
        role: 'OWNER',
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('OWNER grants full control');
  });

  it('refuses any other ACL grant as a non-fix', () => {
    const errors = validateGcpStorageObjectUrl(
      argsFor('/storage/v1/b/my-bucket/acl', 'PATCH', {
        entity: 'user-someone',
        role: 'READER',
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('never an exposure fix');
  });

  it('holds defaultObjectAcl to the same grant bar as acl', () => {
    const errors = validateGcpStorageObjectUrl(
      argsFor('/storage/v1/b/my-bucket/defaultObjectAcl', 'PATCH', {
        entity: 'allUsers',
        role: 'READER',
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('to the public (allUsers)');
  });

  it('sees an encoded acl marker as the ACL endpoint', () => {
    const errors = validateGcpStorageObjectUrl(
      argsFor('/storage/v1/b/my-bucket/%61cl', 'PATCH', {
        entity: 'user-someone',
        role: 'READER',
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('never an exposure fix');
  });

  it('refuses bucket DELETE (destroys a pre-existing bucket)', () => {
    const errors = validateGcpStorageObjectUrl(
      argsFor('/storage/v1/b/my-bucket', 'DELETE'),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('deleting a bucket destroys data');
  });

  it('allows a plain bucket PATCH', () => {
    expect(
      validateGcpStorageObjectUrl(argsFor('/storage/v1/b/my-bucket')),
    ).toEqual([]);
  });

  it('does not misfire on buckets literally named o or acl', () => {
    expect(validateGcpStorageObjectUrl(argsFor('/storage/v1/b/o'))).toEqual([]);
    expect(validateGcpStorageObjectUrl(argsFor('/storage/v1/b/acl'))).toEqual(
      [],
    );
  });

  it('refuses paths that do not decode', () => {
    const errors = validateGcpStorageObjectUrl(
      argsFor('/storage/v1/b/%E0%A4%A'),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('not decodable');
  });
});
