import { isStaticTrustedOrigin } from './origin-policy';

describe('isStaticTrustedOrigin', () => {
  const originalTrustedOrigins = process.env.AUTH_TRUSTED_ORIGINS;

  beforeEach(() => {
    delete process.env.AUTH_TRUSTED_ORIGINS;
  });

  afterAll(() => {
    if (originalTrustedOrigins === undefined) {
      delete process.env.AUTH_TRUSTED_ORIGINS;
      return;
    }
    process.env.AUTH_TRUSTED_ORIGINS = originalTrustedOrigins;
  });

  it('trusts HTTPS subdomains of the wildcard domains', () => {
    expect(isStaticTrustedOrigin('https://anything.gideondefender.com')).toBe(
      true,
    );
    expect(
      isStaticTrustedOrigin('https://anything.staging.gideondefender.com'),
    ).toBe(true);
  });

  it('no longer trusts trust.inc or its subdomains', () => {
    expect(isStaticTrustedOrigin('https://anything.trust.inc')).toBe(false);
    expect(isStaticTrustedOrigin('https://trust.inc')).toBe(false);
  });

  it('does not extend the wildcard match to plain HTTP', () => {
    expect(isStaticTrustedOrigin('http://anything.gideondefender.com')).toBe(
      false,
    );
    expect(
      isStaticTrustedOrigin('http://anything.staging.gideondefender.com'),
    ).toBe(false);
    expect(isStaticTrustedOrigin('http://anything.trust.inc')).toBe(false);
    expect(isStaticTrustedOrigin('http://trust.inc')).toBe(false);
  });

  it('still trusts the explicitly listed http localhost origins', () => {
    expect(isStaticTrustedOrigin('http://localhost:3000')).toBe(true);
    expect(isStaticTrustedOrigin('http://localhost:3333')).toBe(true);
  });

  it('honours an explicit AUTH_TRUSTED_ORIGINS list', () => {
    process.env.AUTH_TRUSTED_ORIGINS = 'http://localhost:4000';
    expect(isStaticTrustedOrigin('http://localhost:4000')).toBe(true);
    expect(isStaticTrustedOrigin('http://localhost:3000')).toBe(false);
  });

  it('rejects unrelated and malformed origins', () => {
    expect(
      isStaticTrustedOrigin('https://gideondefender.com.untrusted.example'),
    ).toBe(false);
    expect(isStaticTrustedOrigin('https://nottrust.inc')).toBe(false);
    expect(isStaticTrustedOrigin('not-a-url')).toBe(false);
    expect(isStaticTrustedOrigin('')).toBe(false);
  });
});
