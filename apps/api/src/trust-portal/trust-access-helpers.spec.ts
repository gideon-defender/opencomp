import {
  extractEmailDomain,
  generateTrustToken,
  getAccentColor,
  hexToPdfRgb,
  isDomainInAllowList,
  isEmailInAllowList,
  normalizePortalDomain,
  normalizePortalUrl,
  toSafeFilename,
  toSafeFilenameWithExtension,
} from './trust-access-helpers';

describe('trust-access-helpers', () => {
  it('converts hex colors to pdf-lib RGB', () => {
    expect(hexToPdfRgb('#3B82F6')).toEqual({
      r: 0x3b / 255,
      g: 0x82 / 255,
      b: 0xf6 / 255,
    });
  });

  it('falls back to the default accent color on missing or invalid input', () => {
    expect(getAccentColor(null)).toEqual({ r: 0, g: 0.302, b: 0.239 });
    expect(getAccentColor('not-a-color')).toEqual({
      r: 0,
      g: 0.302,
      b: 0.239,
    });
  });

  it('generates URL-safe tokens of the requested length', () => {
    const token = generateTrustToken(32);
    expect(token).toHaveLength(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generateTrustToken(32)).not.toBe(generateTrustToken(32));
  });

  it('normalizes portal URLs and domains', () => {
    expect(normalizePortalUrl('http://localhost:3008/')).toBe(
      'http://localhost:3008',
    );
    expect(normalizePortalDomain('https://Trust.Example.com/path')).toBe(
      'trust.example.com',
    );
  });

  it('matches allow-listed domains and emails case-insensitively', () => {
    expect(isDomainInAllowList('Ada@Example.com', ['example.com'])).toBe(true);
    expect(isDomainInAllowList('ada@other.com', ['example.com'])).toBe(false);
    expect(isEmailInAllowList('Ada@Example.com', ['ada@example.com'])).toBe(
      true,
    );
    expect(isEmailInAllowList('ada@other.com', ['ada@example.com'])).toBe(
      false,
    );
    expect(extractEmailDomain('Ada@Example.com')).toBe('example.com');
  });

  it('reads the domain from the last @ so crafted local parts cannot spoof the allow list', () => {
    expect(extractEmailDomain('attacker@allowed.com@evil.com')).toBe(
      'evil.com',
    );
    expect(
      isDomainInAllowList('attacker@allowed.com@evil.com', ['allowed.com']),
    ).toBe(false);
    expect(extractEmailDomain('no-at-sign')).toBe('');
  });

  it('slugifies display names into safe filenames', () => {
    expect(toSafeFilename('Security Updates')).toBe('security_updates');
    expect(toSafeFilename('!!!')).toBe('policy');
  });

  it('preserves the file extension in safe filenames', () => {
    expect(toSafeFilenameWithExtension('Q4 Report.pdf')).toBe('q4_report.pdf');
    expect(toSafeFilenameWithExtension('Report.PDF')).toBe('report.pdf');
    expect(toSafeFilenameWithExtension('Security Updates')).toBe(
      'security_updates',
    );
    expect(toSafeFilenameWithExtension('report.')).toBe('report');
    expect(toSafeFilenameWithExtension('notes.txt ')).toBe('notes.txt');
    expect(toSafeFilenameWithExtension('a.b$c')).toBe('a.bc');
  });
});
