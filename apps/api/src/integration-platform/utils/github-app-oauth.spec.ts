import { githubAppInstallUrl } from './github-app-oauth';

describe('GitHub App installation routing', () => {
  it('routes customers to the configured app', () => {
    expect(
      githubAppInstallUrl({
        customSettings: { githubAppSlug: 'gideon-dev' },
        fallback: 'https://github.com/apps/legacy/installations/new',
      }),
    ).toBe('https://github.com/apps/gideon-dev/installations/new');
  });

  it('keeps the manifest URL for existing apps without an override', () => {
    expect(githubAppInstallUrl({ fallback: 'legacy' })).toBe('legacy');
  });

  it.each(['../other', 'https://evil.example', '', 'app?state=other'])(
    'rejects an invalid slug: %s',
    (slug) => {
      expect(() =>
        githubAppInstallUrl({ customSettings: { githubAppSlug: slug } }),
      ).toThrow();
    },
  );
});
