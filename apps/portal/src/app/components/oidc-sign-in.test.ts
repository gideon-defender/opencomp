import { describe, expect, it } from 'vitest';
import { toAbsoluteUrl } from './oidc-sign-in';

const PORTAL_ORIGIN = 'https://portal.gideondefender.com';

describe('toAbsoluteUrl', () => {
  it('resolves a relative path against the portal origin', () => {
    expect(toAbsoluteUrl('/dashboard', PORTAL_ORIGIN)).toBe(`${PORTAL_ORIGIN}/dashboard`);
  });

  it('keeps an absolute portal URL unchanged', () => {
    expect(toAbsoluteUrl(`${PORTAL_ORIGIN}/dashboard`, PORTAL_ORIGIN)).toBe(
      `${PORTAL_ORIGIN}/dashboard`,
    );
  });

  // The client is not the redirect boundary — the API allowlists absolute
  // targets server-side. Pin the passthrough so a change here is deliberate.
  it('passes absolute URLs through for the API to allowlist', () => {
    expect(toAbsoluteUrl('https://evil.example.com/phish', PORTAL_ORIGIN)).toBe(
      'https://evil.example.com/phish',
    );
  });

  it('passes non-http targets through for the API to drop', () => {
    expect(toAbsoluteUrl('javascript:alert(1)', PORTAL_ORIGIN)).toBe('javascript:alert(1)');
  });

  it('returns unparseable input unchanged', () => {
    expect(toAbsoluteUrl('http://[', PORTAL_ORIGIN)).toBe('http://[');
  });
});
