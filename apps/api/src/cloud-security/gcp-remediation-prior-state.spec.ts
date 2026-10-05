import {
  buildPriorStateMap,
  extractPriorDatabaseFlags,
  findPriorPolicy,
  findPriorSettings,
  findPriorStateValue,
} from './gcp-remediation-prior-state';

const BUCKET_READ = 'https://storage.googleapis.com/storage/v1/b/my-bucket';
const BUCKET_STATE = {
  read: {
    iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
    metageneration: '3',
  },
};

describe('findPriorPolicy', () => {
  it('returns direct bindings records', () => {
    expect(findPriorPolicy({ read: { bindings: [], etag: 'e' } })).toEqual({
      bindings: [],
      etag: 'e',
    });
  });

  it('unwraps the nested getIamPolicy shape', () => {
    expect(findPriorPolicy({ read: { policy: { bindings: [] } } })).toEqual({
      bindings: [],
    });
  });

  it('returns undefined without a policy', () => {
    expect(findPriorPolicy({ read: {} })).toBeUndefined();
    expect(findPriorPolicy(undefined)).toBeUndefined();
  });

  it('returns undefined when two policies match instead of picking one', () => {
    // A first-match pick could bind resource A's policy to resource B's
    // fix — ambiguity fails closed.
    expect(
      findPriorPolicy({
        a: { bindings: [] },
        b: { bindings: [] },
      }),
    ).toBeUndefined();
  });
});

describe('findPriorSettings', () => {
  it('returns the outer record with settings and siblings', () => {
    const outer = { settings: {}, ipAddresses: [] };
    expect(findPriorSettings({ read: outer })).toBe(outer);
  });

  it('returns undefined without settings-like state', () => {
    expect(findPriorSettings({ read: {} })).toBeUndefined();
  });

  it('returns undefined when two settings records match', () => {
    expect(
      findPriorSettings({
        a: { settings: {} },
        b: { settings: {} },
      }),
    ).toBeUndefined();
  });
});

describe('extractPriorDatabaseFlags', () => {
  it('reads nested and top-level flag shapes', () => {
    const flags = [{ name: 'a' }];
    expect(
      extractPriorDatabaseFlags({ settings: { databaseFlags: flags } }),
    ).toBe(flags);
    expect(extractPriorDatabaseFlags({ databaseFlags: flags })).toBe(flags);
  });

  it('returns null without flags', () => {
    expect(extractPriorDatabaseFlags({ settings: {} })).toBeNull();
    expect(extractPriorDatabaseFlags(undefined)).toBeNull();
  });
});

describe('buildPriorStateMap', () => {
  it('keys outputs by read-step purpose', () => {
    expect(
      buildPriorStateMap([
        { step: { purpose: 'read bucket' }, output: { a: 1 } },
        { step: { purpose: 'read iam' }, output: { b: 2 } },
      ]),
    ).toEqual({ 'read bucket': { a: 1 }, 'read iam': { b: 2 } });
  });

  it('refuses duplicate purposes instead of overwriting state', () => {
    // Two reads sharing a purpose would silently drop one output and
    // ground refinement on incomplete data — fail instead of merging.
    expect(() =>
      buildPriorStateMap([
        { step: { purpose: 'read bucket' }, output: { a: 1 } },
        { step: { purpose: 'read bucket' }, output: { b: 2 } },
      ]),
    ).toThrow(/Duplicate read-step purpose/);
  });

  it('refuses missing purposes', () => {
    expect(() =>
      buildPriorStateMap([{ step: { purpose: '' }, output: { a: 1 } }]),
    ).toThrow(/must carry a purpose/);
  });

  it('stores a __proto__ purpose instead of setting the prototype', () => {
    // `purpose` is AI-controlled: on a plain `{}` accumulator this
    // assignment sets the prototype, the output vanishes from later
    // lookups, and a second `__proto__` never trips the duplicate check.
    const state = buildPriorStateMap([
      { step: { purpose: '__proto__' }, output: { a: 1 } },
    ]);
    expect(Object.keys(state)).toContain('__proto__');
    expect(() =>
      buildPriorStateMap([
        { step: { purpose: '__proto__' }, output: { a: 1 } },
        { step: { purpose: '__proto__' }, output: { b: 2 } },
      ]),
    ).toThrow(/Duplicate read-step purpose/);
  });
});

describe('fixed-point binding', () => {
  const readSteps = [{ purpose: 'read', url: BUCKET_READ }];

  it('binds a double-encoded fix URL to its read', () => {
    // `%25` decodes to `%`, so `%256D` is a double-encoded `m`: one decode
    // leaves `%6D`, which never matches the read — only a fixed-point
    // decode binds the fix to the state that authorizes it.
    const fixStep = {
      url: 'https://storage.googleapis.com/storage/v1/b/%256Dy-bucket',
    };
    expect(
      findPriorStateValue(BUCKET_STATE, 'metageneration', {
        readSteps,
        fixStep,
      })?.value,
    ).toBe('3');
  });

  it('still binds a plain fix URL to its read', () => {
    expect(
      findPriorStateValue(BUCKET_STATE, 'metageneration', {
        readSteps,
        fixStep: { url: BUCKET_READ },
      })?.value,
    ).toBe('3');
  });

  it('does not bind a fix URL outside the read resource', () => {
    expect(
      findPriorStateValue(BUCKET_STATE, 'metageneration', {
        readSteps,
        fixStep: {
          url: 'https://storage.googleapis.com/storage/v1/b/other-bucket',
        },
      }),
    ).toBeUndefined();
  });

  it('does not bind across query-selected identities in queryParams', () => {
    // `?name=` selects the SQL user: alice's read must never ground bob's
    // fix, even when the identity rides the queryParams object instead of
    // the raw URL.
    const state = { read: { settings: { tier: 'db-f1-micro' } } };
    const aliceRead = [
      {
        purpose: 'read',
        url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i/users',
        queryParams: { name: 'alice' },
      },
    ];
    expect(
      findPriorStateValue(state, 'settings', {
        readSteps: aliceRead,
        fixStep: {
          url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i/users',
          queryParams: { name: 'bob' },
        },
      }),
    ).toBeUndefined();
    expect(
      findPriorStateValue(state, 'settings', {
        readSteps: aliceRead,
        fixStep: {
          url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i/users',
          queryParams: { name: 'alice' },
        },
      })?.value,
    ).toEqual({ tier: 'db-f1-micro' });
  });
});
