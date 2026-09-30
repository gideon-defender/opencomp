import { describe, expect, it } from 'vitest';
import { isSafeHttpUrl, toSafeExternalHref } from './urls';

describe('isSafeHttpUrl', () => {
  it('accepts http and https targets', () => {
    expect(isSafeHttpUrl('https://example.com')).toBe(true);
    expect(isSafeHttpUrl('http://example.com/path?q=1')).toBe(true);
    expect(isSafeHttpUrl('HTTPS://EXAMPLE.COM')).toBe(true);
  });

  it('rejects non-http schemes and unparsable values', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<h1>x</h1>')).toBe(false);
    expect(isSafeHttpUrl('ftp://example.com/file')).toBe(false);
    expect(isSafeHttpUrl('not a url')).toBe(false);
    expect(isSafeHttpUrl('')).toBe(false);
  });
});

describe('toSafeExternalHref', () => {
  it('prefixes bare domains with https', () => {
    expect(toSafeExternalHref('example.com')).toBe('https://example.com');
    expect(toSafeExternalHref('  example.com  ')).toBe('https://example.com');
  });

  it('keeps http(s) targets as-is', () => {
    expect(toSafeExternalHref('https://example.com')).toBe('https://example.com');
    expect(toSafeExternalHref('http://example.com')).toBe('http://example.com');
  });

  it('returns null for unsafe schemes and empty values', () => {
    expect(toSafeExternalHref('javascript:alert(1)')).toBeNull();
    expect(toSafeExternalHref('httpsomething')).toBe('https://httpsomething');
    expect(toSafeExternalHref(null)).toBeNull();
    expect(toSafeExternalHref('   ')).toBeNull();
  });
});
