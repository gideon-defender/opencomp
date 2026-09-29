import { describe, expect, it } from 'vitest';
import { registrableDomain, upgradeFaviconUrl } from './vendor-logo';

describe('upgradeFaviconUrl', () => {
  it('upgrades known-bad Google favicon URLs to high-res assets', () => {
    expect(
      upgradeFaviconUrl(
        'https://www.google.com/s2/favicons?domain=github.com&sz=128',
      ),
    ).toBe(
      'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
    );
    expect(
      upgradeFaviconUrl(
        'https://www.google.com/s2/favicons?domain=cloud.google.com&sz=128',
      ),
    ).toBe(
      'https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png',
    );
  });

  it('leaves good favicons, manual uploads, and empty values alone', () => {
    const aws = 'https://www.google.com/s2/favicons?domain=aws.amazon.com&sz=128';
    expect(upgradeFaviconUrl(aws)).toBe(aws);
    expect(upgradeFaviconUrl('https://example.com/custom-logo.png')).toBe(
      'https://example.com/custom-logo.png',
    );
    expect(upgradeFaviconUrl(null)).toBeNull();
  });

  it('returns null for unparsable input instead of handing it to <img src>', () => {
    expect(upgradeFaviconUrl('not a url')).toBeNull();
    expect(upgradeFaviconUrl('https://exa mple.com/logo.png')).toBeNull();
  });
});

describe('registrableDomain', () => {
  it('keeps two-part domains and strips subdomains', () => {
    expect(registrableDomain('github.com')).toBe('github.com');
    expect(registrableDomain('cloud.google.com')).toBe('google.com');
  });

  it('handles multi-part public suffixes', () => {
    expect(registrableDomain('example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('sub.example.co.uk')).toBe('example.co.uk');
  });
});
