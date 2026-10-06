import {
  collectPriorDatabaseFlags,
  coveringReadSteps,
  extractPriorDatabaseFlags,
  findPriorPolicy,
  findPriorPolicyForUrl,
  findPriorSettings,
  findPriorSettingsForUrl,
} from './gcp-remediation-prior-lookups';

const FIX = { url: 'https://storage.googleapis.com/storage/v1/b/my-bucket' };
const POLICY = { bindings: [{ role: 'roles/viewer', members: ['a@x.com'] }] };

describe('coveringReadSteps', () => {
  it('matches exact and parent resources, not siblings or children', () => {
    const fix = { url: `${FIX.url}/o/obj` };
    const readSteps = [
      { purpose: 'exact', url: fix.url },
      { purpose: 'parent', url: FIX.url },
      { purpose: 'sibling', url: `${FIX.url}-other` },
      { purpose: 'child', url: `${fix.url}/nested` },
    ];
    const purposes = coveringReadSteps({ readSteps, fixStep: fix }).map(
      (step) => step.purpose,
    );
    // A read covers the fix when the read is the fix resource or its
    // parent — a child read never grounds a parent fix, and a sibling
    // shares only a string prefix.
    expect(purposes).toEqual(['exact', 'parent']);
  });

  it('never binds across query-selected identity (?name=)', () => {
    const readSteps = [{ purpose: 'alice', url: `${FIX.url}?name=alice` }];
    expect(
      coveringReadSteps({
        readSteps,
        fixStep: { url: `${FIX.url}?name=bob` },
      }),
    ).toEqual([]);
  });
});

describe('findPriorPolicy', () => {
  it('unwraps the getIamPolicy shape', () => {
    expect(findPriorPolicy({ read: { policy: POLICY } })).toEqual(POLICY);
  });

  it('fails closed on ambiguity (two policies)', () => {
    expect(
      findPriorPolicy({ a: { ...POLICY }, b: { ...POLICY } }),
    ).toBeUndefined();
  });

  it('returns undefined without state', () => {
    expect(findPriorPolicy(undefined)).toBeUndefined();
    expect(findPriorPolicy({})).toBeUndefined();
  });
});

describe('findPriorPolicyForUrl', () => {
  const readSteps = [
    { purpose: 'target', url: `${FIX.url}:getIamPolicy` },
    { purpose: 'other', url: 'https://storage.googleapis.com/storage/v1/b/other:getIamPolicy' },
  ];

  it('binds only the covering read', () => {
    expect(
      findPriorPolicyForUrl(
        { target: { ...POLICY }, other: { bindings: [] } },
        readSteps,
        FIX,
      ),
    ).toEqual(POLICY);
  });

  it('fails closed without a read-step map', () => {
    // A global fallback would bind resource A's policy to B's fix.
    expect(findPriorPolicyForUrl({ read: { ...POLICY } }, undefined, FIX)).toBeUndefined();
    expect(findPriorPolicyForUrl({ read: { ...POLICY } }, [], FIX)).toBeUndefined();
  });

  it('fails closed when no read covers the fix', () => {
    expect(
      findPriorPolicyForUrl({ other: { ...POLICY } }, readSteps, {
        url: 'https://storage.googleapis.com/storage/v1/b/stranger',
      }),
    ).toBeUndefined();
  });
});

describe('settings lookups', () => {
  const SETTINGS = { settings: { ipConfiguration: { ipv4Enabled: true } } };

  it('finds settings records and fails closed on ambiguity', () => {
    expect(findPriorSettings({ read: { ...SETTINGS } })).toEqual({
      ...SETTINGS,
    });
    expect(
      findPriorSettings({ a: { ...SETTINGS }, b: { ...SETTINGS } }),
    ).toBeUndefined();
  });

  it('binds settings to the fix URL', () => {
    const readSteps = [{ purpose: 'db', url: FIX.url }];
    expect(
      findPriorSettingsForUrl({ db: { ...SETTINGS } }, readSteps, FIX),
    ).toEqual({ ...SETTINGS });
    expect(
      findPriorSettingsForUrl({ db: { ...SETTINGS } }, undefined, FIX),
    ).toBeUndefined();
  });

  it('extracts database flags from wrapped and unwrapped shapes', () => {
    expect(
      extractPriorDatabaseFlags({
        settings: { databaseFlags: [{ name: 'log_connections' }] },
      }),
    ).toEqual([{ name: 'log_connections' }]);
    expect(
      extractPriorDatabaseFlags({ databaseFlags: [{ name: 'x' }] }),
    ).toEqual([{ name: 'x' }]);
    expect(extractPriorDatabaseFlags({})).toBeNull();
  });

  it('collects flags across records, null when none', () => {
    expect(
      collectPriorDatabaseFlags({ a: { databaseFlags: [{ name: 'x' }] } }),
    ).toEqual([{ name: 'x' }]);
    expect(collectPriorDatabaseFlags({ a: {} })).toBeNull();
    expect(collectPriorDatabaseFlags(undefined)).toBeNull();
  });
});
