import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  generateUnsubscribeToken,
  generateUserUnsubscribeToken,
  getUnsubscribeUrl,
  getUserUnsubscribeUrl,
  normalizeEmail,
  verifyUnsubscribeToken,
  verifyUserUnsubscribeToken,
} from './unsubscribe';

process.env.UNSUBSCRIBE_SECRET = 'test-secret';

describe('unsubscribe tokens', () => {
  it('emits a legacy email-only link without a user id', () => {
    const url = getUnsubscribeUrl('person@example.com');
    expect(url).toContain('email=person%40example.com');
    expect(url).not.toContain('userId=');
    const token = new URL(url).searchParams.get('token')!;
    expect(verifyUnsubscribeToken('person@example.com', token)).toBe(true);
  });

  it('emits a user-scoped link when the user id is known', () => {
    const url = getUnsubscribeUrl('person@example.com', 'usr_a');
    const params = new URL(url).searchParams;
    expect(params.get('userId')).toBe('usr_a');
    expect(
      verifyUserUnsubscribeToken({
        userId: 'usr_a',
        email: 'person@example.com',
        token: params.get('token')!,
      }),
    ).toBe(true);
  });

  it('binds the scoped token to one account: same email, other user fails', () => {
    const token = generateUserUnsubscribeToken({
      userId: 'usr_a',
      email: 'person@example.com',
    });
    expect(
      verifyUserUnsubscribeToken({
        userId: 'usr_b',
        email: 'person@example.com',
        token,
      }),
    ).toBe(false);
  });

  it('normalizes legacy tokens so capitalized addresses verify', () => {
    const token = generateUnsubscribeToken('Person@Example.com');
    expect(verifyUnsubscribeToken('person@example.com', token)).toBe(true);
    expect(getUserUnsubscribeUrl({ userId: 'usr_a', email: 'x@y.z' })).toContain('userId=usr_a');
  });

  it('accepts pre-scoping raw tokens so in-flight links keep working', () => {
    // Links minted before tenant scoping hashed the raw address.
    const rawEmail = 'Person@Example.com';
    const rawToken = createHmac('sha256', process.env.UNSUBSCRIBE_SECRET!)
      .update(rawEmail)
      .digest('base64url');
    expect(rawToken).not.toBe(generateUnsubscribeToken(rawEmail));
    expect(verifyUnsubscribeToken(rawEmail, rawToken)).toBe(true);
    expect(verifyUnsubscribeToken('person@example.com', rawToken)).toBe(false);
  });

  it('fails closed when no secret is configured', () => {
    const savedUnsub = process.env.UNSUBSCRIBE_SECRET;
    const savedAuth = process.env.AUTH_SECRET;
    delete process.env.UNSUBSCRIBE_SECRET;
    delete process.env.AUTH_SECRET;
    try {
      expect(() => generateUnsubscribeToken('a@b.c')).toThrow();
    } finally {
      if (savedUnsub !== undefined) process.env.UNSUBSCRIBE_SECRET = savedUnsub;
      if (savedAuth !== undefined) process.env.AUTH_SECRET = savedAuth;
    }
  });
});

// Contract: identical to `normalizeEmail` in `@gideon-defender/db`
// (`packages/db/src/normalize-email.ts`). Keep both in sync.
describe('normalizeEmail contract', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Person@Example.COM \t')).toBe('person@example.com');
  });

  it('leaves already-normal addresses alone', () => {
    expect(normalizeEmail('person@example.com')).toBe('person@example.com');
  });
});
