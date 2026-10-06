import {
  buildEffectiveGcpStepUrl,
  decodeGcpPathToFixedPoint,
  parsedGcpUrl,
  resolvedPathSegments,
  sameQueryIdentity,
  stepQueryParamValues,
  urlResource,
} from './gcp-remediation-step-url';

describe('buildEffectiveGcpStepUrl', () => {
  it('merges queryParams onto the raw URL', () => {
    expect(
      buildEffectiveGcpStepUrl({
        url: 'https://x.example/a?b=1',
        queryParams: { c: '2' },
      }),
    ).toBe('https://x.example/a?b=1&c=2');
  });

  it('skips non-primitive query values (objects must not ride the wire unseen)', () => {
    const url = buildEffectiveGcpStepUrl({
      url: 'https://x.example/a',
      queryParams: { role: { nested: 'roles/owner' } },
    });
    expect(url).toBe('https://x.example/a');
  });

  it('serializes array values as repeated params', () => {
    expect(
      buildEffectiveGcpStepUrl({
        url: 'https://x.example/a',
        queryParams: { members: ['a', 'b'] },
      }),
    ).toBe('https://x.example/a?members=a&members=b');
  });
});

describe('decodeGcpPathToFixedPoint', () => {
  it('decodes double-encoded separators', () => {
    // `%253A` decodes twice to `:` — guards must see the executed form.
    expect(decodeGcpPathToFixedPoint('/v1/b%253Amy-bucket')).toBe(
      '/v1/b:my-bucket',
    );
  });
});

describe('parsedGcpUrl', () => {
  it('matches hostname exactly, not by substring', () => {
    expect(
      parsedGcpUrl('https://evil.com/?x=sqladmin.googleapis.com')?.hostname,
    ).toBe('evil.com');
    expect(
      parsedGcpUrl('https://sqladmin.googleapis.com.evil.com/')?.hostname,
    ).toBe('sqladmin.googleapis.com.evil.com');
  });

  it('resolves dot-segments the way the server routes them', () => {
    expect(
      parsedGcpUrl('https://storage.googleapis.com/storage/v1/../v1/b/x')
        ?.pathname,
    ).toBe('/storage/v1/b/x');
  });

  it('returns undefined for non-absolute URLs', () => {
    expect(parsedGcpUrl('/relative/path')).toBeUndefined();
  });
});

describe('sameQueryIdentity', () => {
  const base = 'https://sqladmin.googleapis.com/v1/projects/p/instances/i/users';

  it('distinguishes ?name= identities', () => {
    expect(
      sameQueryIdentity({ url: `${base}?name=alice` }, { url: `${base}?name=bob` }),
    ).toBe(false);
    expect(
      sameQueryIdentity({ url: `${base}?name=alice` }, { url: `${base}?name=alice` }),
    ).toBe(true);
  });

  it('reads identity off merged queryParams too', () => {
    expect(
      sameQueryIdentity(
        { url: base, queryParams: { name: 'alice' } },
        { url: `${base}?name=alice` },
      ),
    ).toBe(true);
  });

  it('fails closed on unparseable URLs', () => {
    expect(sameQueryIdentity({ url: ':::' }, { url: base })).toBe(false);
  });
});

describe('stepQueryParamValues', () => {
  it('sees values from both the raw URL and queryParams', () => {
    expect(
      stepQueryParamValues(
        { url: 'https://x.example/a?role=a', queryParams: { role: 'b' } },
        'role',
      ).sort(),
    ).toEqual(['a', 'b']);
  });
});

describe('urlResource', () => {
  it('keeps sibling resources distinct', () => {
    expect(urlResource('https://storage.googleapis.com/storage/v1/b/a')).not.toBe(
      urlResource('https://storage.googleapis.com/storage/v1/b/b'),
    );
  });

  it('decodes before comparing so encoded URLs bind correctly', () => {
    expect(urlResource('https://storage.googleapis.com/storage/v1/b%2Fmy')).toBe(
      urlResource('https://storage.googleapis.com/storage/v1/b/my'),
    );
  });
});

describe('resolvedPathSegments', () => {
  it('returns decoded segments for project binding', () => {
    expect(resolvedPathSegments('/v1/projects/p/instances/i')).toEqual([
      'v1',
      'projects',
      'p',
      'instances',
      'i',
    ]);
  });
});
