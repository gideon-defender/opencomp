import {
  asRecord,
  bindingsGrantPublicAccess,
  bodyGrantsPublicAccessDeep,
  datasetAccessGrantsPublicAccess,
  extractGcpFindingBucket,
  extractGcpStepBucket,
  extractGcpStepProjectId,
  isPublicAclEntry,
  isPublicPredefinedAcl,
  isSetIamPolicyUrl,
  rangesExposeFullIpSpace,
  stepLabel,
  stepQueryParam,
  stepQueryParamValues,
  urlResource,
  validateGcpStepProject,
} from './gcp-remediation-validator-shared';

describe('stepLabel', () => {
  it('uses the URL path, not the full URL', () => {
    expect(
      stepLabel({ method: 'PATCH', url: 'https://example.com/v1/x?y=1' }, 0),
    ).toBe('Step 1 (PATCH /v1/x)');
  });

  it('falls back to the raw URL when unparseable', () => {
    expect(stepLabel({ method: 'GET', url: 'not-a-url' }, 2)).toBe(
      'Step 3 (GET not-a-url)',
    );
  });

  it('strips query and fragment from unparseable URLs (no secret echo)', () => {
    expect(
      stepLabel({ method: 'GET', url: 'not-a-url?access_token=SECRET' }, 0),
    ).toBe('Step 1 (GET not-a-url)');
    expect(stepLabel({ method: 'GET', url: 'not-a-url#fragSECRET' }, 0)).toBe(
      'Step 1 (GET not-a-url)',
    );
  });
});

describe('rangesExposeFullIpSpace', () => {
  it('refuses the exact open ranges', () => {
    expect(rangesExposeFullIpSpace(['0.0.0.0/0'])).toBe(true);
    expect(rangesExposeFullIpSpace(['::/0'])).toBe(true);
  });

  it('refuses split halves that jointly cover everything', () => {
    expect(rangesExposeFullIpSpace(['0.0.0.0/1', '128.0.0.0/1'])).toBe(true);
  });

  it('allows private and scoped ranges', () => {
    expect(rangesExposeFullIpSpace(['10.0.0.0/8'])).toBe(false);
    expect(rangesExposeFullIpSpace(['10.0.0.0/8', '203.0.113.7/32'])).toBe(
      false,
    );
    expect(rangesExposeFullIpSpace(['2001:db8::/32'])).toBe(false);
  });

  it('fails closed on unparseable entries', () => {
    expect(rangesExposeFullIpSpace(['not-a-range'])).toBe(true);
    expect(rangesExposeFullIpSpace('0.0.0.0/0')).toBe(false);
  });

  it('fails closed on non-string and empty entries', () => {
    expect(rangesExposeFullIpSpace([123])).toBe(true);
    expect(rangesExposeFullIpSpace([null])).toBe(true);
    expect(rangesExposeFullIpSpace([''])).toBe(true);
    expect(rangesExposeFullIpSpace(['10.0.0.0/8', null])).toBe(true);
  });

  it('trims entries before matching the open range', () => {
    expect(rangesExposeFullIpSpace([' 0.0.0.0/0 '])).toBe(true);
    expect(rangesExposeFullIpSpace([' ::/0 '])).toBe(true);
  });

  it('refuses IPv6 split halves that jointly cover everything', () => {
    expect(rangesExposeFullIpSpace(['::/1', '8000::/1'])).toBe(true);
  });

  it('allows narrow IPv6 ranges', () => {
    expect(rangesExposeFullIpSpace(['2001:db8::/32'])).toBe(false);
    expect(rangesExposeFullIpSpace(['2001:db8::/32', 'fd00::/8'])).toBe(false);
  });
});

describe('isPublicAclEntry', () => {
  it('flags public grantees only', () => {
    expect(isPublicAclEntry({ entity: 'allUsers', role: 'READER' })).toBe(true);
    expect(
      isPublicAclEntry({ entity: 'allAuthenticatedUsers', role: 'READER' }),
    ).toBe(true);
    expect(
      isPublicAclEntry({ entity: 'user-a@example.com', role: 'READER' }),
    ).toBe(false);
    expect(isPublicAclEntry(null)).toBe(false);
  });
});

describe('isPublicPredefinedAcl', () => {
  it('flags public canned ACLs only', () => {
    expect(isPublicPredefinedAcl('publicRead')).toBe(true);
    expect(isPublicPredefinedAcl('publicReadWrite')).toBe(true);
    // authenticatedRead grants READER to allAuthenticatedUsers — the same
    // public the ACL-entity check refuses, under a canned-ACL name.
    expect(isPublicPredefinedAcl('authenticatedRead')).toBe(true);
    expect(isPublicPredefinedAcl('AUTHENTICATEDREAD')).toBe(true);
    expect(isPublicPredefinedAcl('private')).toBe(false);
    expect(isPublicPredefinedAcl(undefined)).toBe(false);
  });
});

describe('extractGcpStepProjectId', () => {
  it('reads the /projects/ path segment', () => {
    expect(
      extractGcpStepProjectId({
        url: 'https://compute.googleapis.com/compute/v1/projects/mine/zones/z/instances/i',
      }),
    ).toBe('mine');
  });

  it('reads the effective project query param on project-less paths', () => {
    expect(
      extractGcpStepProjectId({
        url: 'https://storage.googleapis.com/storage/v1/b',
        queryParams: { project: 'mine' },
      }),
    ).toBe('mine');
  });

  it('returns undefined when the URL carries no project signal', () => {
    expect(
      extractGcpStepProjectId({
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
      }),
    ).toBeUndefined();
  });
});

describe('validateGcpStepProject', () => {
  it('refuses steps naming another project', () => {
    const errors = validateGcpStepProject({
      step: {
        url: 'https://compute.googleapis.com/compute/v1/projects/other/global/firewalls/f',
      },
      expectedProjectId: 'mine',
      prefix: 'Step 1',
    });
    expect(errors.join(' ')).toMatch(/targets project "other"/);
  });

  it('accepts same-project steps and refuses unbound bucket steps', () => {
    expect(
      validateGcpStepProject({
        step: {
          url: 'https://compute.googleapis.com/compute/v1/projects/mine/zones/z/instances/i',
        },
        expectedProjectId: 'mine',
        prefix: 'Step 1',
      }),
    ).toEqual([]);
    // A bare bucket path carries no project signal, so a project-only
    // finding cannot prove which bucket the step touches — fail closed.
    const errors = validateGcpStepProject({
      step: { url: 'https://storage.googleapis.com/storage/v1/b/x' },
      expectedProjectId: 'mine',
      prefix: 'Step 1',
    });
    expect(errors.join(' ')).toMatch(/names no bucket/);
  });

  it('refuses project-scoped steps when the finding names no project', () => {
    // An empty expected project used to pass everything — fail open. A
    // step that names a project the finding cannot bind is unverifiable.
    const errors = validateGcpStepProject({
      step: {
        url: 'https://compute.googleapis.com/compute/v1/projects/other/zones/z/instances/i',
      },
      expectedProjectId: '',
      prefix: 'Step 1',
    });
    expect(errors.join(' ')).toMatch(/no resolvable project/);
  });

  it('refuses non-Storage URLs that name no project when bound', () => {
    // Every non-Storage GCP API embeds /projects/<id>/ — a missing signal
    // there is malformed or evasive, never legitimate (Storage buckets are
    // globally namespaced and covered by the test above).
    const errors = validateGcpStepProject({
      step: {
        url: 'https://compute.googleapis.com/compute/v1/zones/z/instances/i',
      },
      expectedProjectId: 'mine',
      prefix: 'Step 1',
    });
    expect(errors.join(' ')).toMatch(/names no project/);
  });

  it('refuses unparseable URLs when bound', () => {
    const errors = validateGcpStepProject({
      step: { url: 'not-a-url' },
      expectedProjectId: 'mine',
      prefix: 'Step 1',
    });
    expect(errors.join(' ')).toMatch(/not parseable/);
  });
});

describe('double-encoded action URLs', () => {
  it('recognizes double-encoded :setIamPolicy as IAM', () => {
    // Single-decode sees `%3A`; the server routes the fully-decoded `:`
    // form — the guard must match what executes, not the first decoding.
    expect(
      isSetIamPolicyUrl(
        'https://cloudresourcemanager.googleapis.com/v3/projects/p%253AsetIamPolicy',
      ),
    ).toBe(true);
  });

  it('extracts double-encoded /projects/ segments', () => {
    expect(
      extractGcpStepProjectId({
        url: 'https://compute.googleapis.com/compute/v1/projects%252Fother/zones/z/instances/i',
      }),
    ).toBe('other');
  });
});

describe('asRecord', () => {
  it('narrows plain objects and rejects the rest', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord(null)).toBeNull();
    expect(asRecord([1])).toBeNull();
    expect(asRecord('x')).toBeNull();
  });
});

describe('stepQueryParamValues', () => {
  it('returns values from both queryParams and the raw URL', () => {
    // Order follows the wire: the raw URL query comes first, appended
    // queryParams second. Consumers treat the result as a union.
    expect(
      stepQueryParamValues(
        {
          url: 'https://x.example/?predefinedAcl=publicRead',
          queryParams: { predefinedAcl: 'private' },
        },
        'predefinedAcl',
      ),
    ).toEqual(['publicRead', 'private']);
  });

  it('returns an empty array when the param is absent everywhere', () => {
    expect(
      stepQueryParamValues(
        { url: 'https://x.example/?a=1', queryParams: { b: '2' } },
        'missing',
      ),
    ).toEqual([]);
  });

  it('stepQueryParam keeps returning the first effective value', () => {
    expect(
      stepQueryParam(
        { url: 'https://x.example/', queryParams: { a: '1' } },
        'a',
      ),
    ).toBe('1');
    expect(stepQueryParam({ url: 'https://x.example/?a=2' }, 'a')).toBe('2');
    expect(stepQueryParam({ url: 'https://x.example/' }, 'a')).toBeUndefined();
  });
});

describe('isSetIamPolicyUrl', () => {
  it('matches a trailing slash after the action', () => {
    expect(
      isSetIamPolicyUrl(
        'https://cloudresourcemanager.googleapis.com/v3/projects/p:setIamPolicy/',
      ),
    ).toBe(true);
    expect(
      isSetIamPolicyUrl(
        'https://cloudresourcemanager.googleapis.com/v3/projects/p:setIamPolicy',
      ),
    ).toBe(true);
    expect(
      isSetIamPolicyUrl('https://storage.googleapis.com/storage/v1/b/x/iam'),
    ).toBe(false);
  });
});

describe('CIDR fail-closed shapes', () => {
  it('refuses CIDRs with extra path segments', () => {
    expect(rangesExposeFullIpSpace(['10.0.0.0/8/evil'])).toBe(true);
    expect(rangesExposeFullIpSpace(['2001:db8::/32/evil'])).toBe(true);
  });
});

describe('urlResource', () => {
  it('resolves dot segments the way the server routes them', () => {
    expect(
      urlResource('https://storage.googleapis.com/storage/v1/b/good/../evil'),
    ).toBe('https://storage.googleapis.com/storage/v1/b/evil');
  });

  it('keeps sibling resources distinct', () => {
    expect(
      urlResource('https://storage.googleapis.com/storage/v1/b/a'),
    ).not.toBe(urlResource('https://storage.googleapis.com/storage/v1/b/b'));
  });
});

describe('bindingsGrantPublicAccess', () => {
  it('flags public members and ignores private ones', () => {
    expect(
      bindingsGrantPublicAccess([
        { role: 'roles/viewer', members: ['allUsers'] },
      ]),
    ).toBe(true);
    expect(
      bindingsGrantPublicAccess([
        { role: 'roles/viewer', members: ['AllAuthenticatedUsers'] },
      ]),
    ).toBe(true);
    expect(
      bindingsGrantPublicAccess([
        { role: 'roles/viewer', members: ['alice@example.com'] },
      ]),
    ).toBe(false);
    expect(bindingsGrantPublicAccess([])).toBe(false);
    expect(bindingsGrantPublicAccess(undefined)).toBe(false);
  });
});

describe('datasetAccessGrantsPublicAccess', () => {
  it('flags public special groups', () => {
    expect(
      datasetAccessGrantsPublicAccess([
        { role: 'READER', specialGroup: 'allAuthenticatedUsers' },
      ]),
    ).toBe(true);
    expect(
      datasetAccessGrantsPublicAccess([
        { role: 'READER', specialGroup: 'projectReaders' },
      ]),
    ).toBe(false);
    expect(datasetAccessGrantsPublicAccess(undefined)).toBe(false);
  });

  it('flags public grants via the iamMember field', () => {
    // BigQuery documents `access[].iamMember` as the IAM-policy member
    // field — `allUsers` there is the same exposure as `specialGroup`.
    expect(
      datasetAccessGrantsPublicAccess([
        { role: 'READER', iamMember: 'allUsers' },
      ]),
    ).toBe(true);
    expect(
      datasetAccessGrantsPublicAccess([
        { role: 'READER', iamMember: 'user:alice@example.com' },
      ]),
    ).toBe(false);
  });

  it('flags grants to a whole domain', () => {
    // A domain grant shares the dataset outside the organization — never
    // a narrow fix, so any non-empty domain reads as public.
    expect(
      datasetAccessGrantsPublicAccess([
        { role: 'READER', domain: 'evil.example' },
      ]),
    ).toBe(true);
    expect(datasetAccessGrantsPublicAccess([{ role: 'READER' }])).toBe(false);
  });
});

describe('bodyGrantsPublicAccessDeep', () => {
  it('flags nested iamMember and domain grants', () => {
    expect(
      bodyGrantsPublicAccessDeep({
        access: [{ role: 'READER', iamMember: 'allUsers' }],
      }),
    ).toBe(true);
    expect(
      bodyGrantsPublicAccessDeep({
        access: [{ role: 'READER', domain: 'evil.example' }],
      }),
    ).toBe(true);
    expect(
      bodyGrantsPublicAccessDeep({
        access: [{ role: 'READER', userByEmail: 'alice@example.com' }],
      }),
    ).toBe(false);
  });
});

describe('extractGcpStepBucket', () => {
  it('reads the bucket from resource and IAM paths', () => {
    expect(
      extractGcpStepBucket(
        'https://storage.googleapis.com/storage/v1/b/my-bucket',
      ),
    ).toBe('my-bucket');
    expect(
      extractGcpStepBucket(
        'https://storage.googleapis.com/storage/v1/b/my-bucket/iam',
      ),
    ).toBe('my-bucket');
    expect(
      extractGcpStepBucket(
        'https://storage.googleapis.com/upload/storage/v1/b/my-bucket/o',
      ),
    ).toBe('my-bucket');
  });

  it('decodes encoded bucket segments to the routed value', () => {
    expect(
      extractGcpStepBucket(
        'https://storage.googleapis.com/storage/v1/b/my%2Dbucket/o/x',
      ),
    ).toBe('my-bucket');
  });

  it('returns undefined when the URL names no bucket', () => {
    expect(
      extractGcpStepBucket('https://storage.googleapis.com/storage/v1/b'),
    ).toBeUndefined();
    expect(
      extractGcpStepBucket(
        'https://storage.googleapis.com/storage/v1/b?project=p',
      ),
    ).toBeUndefined();
    expect(extractGcpStepBucket('not-a-url')).toBeUndefined();
  });
});

describe('extractGcpFindingBucket', () => {
  it('reads the bucket as the last resource-id segment', () => {
    expect(extractGcpFindingBucket({ resourceId: 'my-proj/my-bucket' })).toBe(
      'my-bucket',
    );
    expect(
      extractGcpFindingBucket({
        resourceId: 'projects/my-proj/buckets/my-bucket',
      }),
    ).toBe('my-bucket');
  });

  it('returns undefined without a bucket signal', () => {
    expect(
      extractGcpFindingBucket({ resourceId: 'my-bucket' }),
    ).toBeUndefined();
    expect(extractGcpFindingBucket({ resourceId: null })).toBeUndefined();
    expect(extractGcpFindingBucket({ resourceId: '' })).toBeUndefined();
  });
});

describe('validateGcpStepProject bucket binding', () => {
  const bucketUrl = 'https://storage.googleapis.com/storage/v1/b/my-bucket';

  it('accepts the finding bucket and refuses any other bucket', () => {
    expect(
      validateGcpStepProject({
        step: { url: bucketUrl },
        expectedProjectId: 'my-proj',
        expectedBucket: 'my-bucket',
        prefix: 'Step 1',
      }),
    ).toEqual([]);
    const errors = validateGcpStepProject({
      step: {
        url: 'https://storage.googleapis.com/storage/v1/b/other-bucket',
      },
      expectedProjectId: 'my-proj',
      expectedBucket: 'my-bucket',
      prefix: 'Step 1',
    });
    expect(errors.join(' ')).toMatch(/targets bucket "other-bucket"/);
  });

  it('refuses bucket-less Storage URLs when a bucket binds', () => {
    const errors = validateGcpStepProject({
      step: { url: 'https://storage.googleapis.com/storage/v1/b' },
      expectedProjectId: 'my-proj',
      expectedBucket: 'my-bucket',
      prefix: 'Step 1',
    });
    expect(errors.join(' ')).toMatch(/names no bucket/);
  });

  it('refuses bucket-naming Storage steps without an expected bucket', () => {
    // A fix for one bucket must never write another: without a bucket
    // binding the step names a globally-unique bucket the finding cannot
    // pin down, even when the project matches.
    const errors = validateGcpStepProject({
      step: {
        url: 'https://storage.googleapis.com/storage/v1/b/any-bucket',
      },
      expectedProjectId: 'my-proj',
      prefix: 'Step 1',
    });
    expect(errors.join(' ')).toMatch(/names no bucket/);
  });

  it('refuses bucket-naming steps when the finding binds nothing', () => {
    const errors = validateGcpStepProject({
      step: {
        url: 'https://storage.googleapis.com/storage/v1/b/any-bucket',
      },
      expectedProjectId: '',
      prefix: 'Step 1',
    });
    expect(errors.join(' ')).toMatch(/names no bucket/);
  });

  it('binds buckets without a project signal', () => {
    expect(
      validateGcpStepProject({
        step: { url: bucketUrl },
        expectedProjectId: '',
        expectedBucket: 'my-bucket',
        prefix: 'Step 1',
      }),
    ).toEqual([]);
    const errors = validateGcpStepProject({
      step: {
        url: 'https://storage.googleapis.com/storage/v1/b/other-bucket',
      },
      expectedProjectId: '',
      expectedBucket: 'my-bucket',
      prefix: 'Step 1',
    });
    expect(errors.join(' ')).toMatch(/cross-bucket/);
  });

  it('still refuses project mismatches on Storage URLs', () => {
    const errors = validateGcpStepProject({
      step: {
        url: 'https://storage.googleapis.com/storage/v1/b/my-bucket?project=other',
      },
      expectedProjectId: 'my-proj',
      expectedBucket: 'my-bucket',
      prefix: 'Step 1',
    });
    expect(errors.join(' ')).toMatch(/targets project "other"/);
  });
});

describe('traversal-safe project and bucket bindings', () => {
  it('never binds a traversal path to the pre-traversal project', () => {
    // The allowlist and the fetch resolve `..` to the attacker project —
    // the binding must see the same resolved path, never `victim`.
    for (const traversal of ['..', '%2e%2e', '%252e%252e', '..%2f..']) {
      const url = `https://compute.googleapis.com/compute/v1/projects/victim/${traversal}/projects/attacker/zones/z/instances/i`;
      expect(extractGcpStepProjectId({ url })).not.toBe('victim');
      const errors = validateGcpStepProject({
        step: { url },
        expectedProjectId: 'victim',
        prefix: 'Step 1',
      });
      expect(errors.join(' ')).toMatch(/refused for safety/);
    }
  });

  it('binds the bucket the server routes to, not the pre-traversal one', () => {
    expect(
      extractGcpStepBucket(
        'https://storage.googleapis.com/storage/v1/b/victim/../attacker/o/x',
      ),
    ).toBe('attacker');
    expect(
      extractGcpStepBucket(
        'https://storage.googleapis.com/storage/v1/b/victim/%2e%2e/attacker/o/x',
      ),
    ).toBe('attacker');
  });
});
