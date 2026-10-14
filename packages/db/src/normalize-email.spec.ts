import { describe, expect, it } from 'vitest';
import { normalizeEmail } from './normalize-email';

// Contract: identical to `normalizeEmail` in `@gideon-defender/email`
// (`packages/email/lib/unsubscribe.ts`). Keep both in sync — the contract
// migration CHECK enforces this exact form.
describe('normalizeEmail contract', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Person@Example.COM \t')).toBe('person@example.com');
  });

  it('leaves already-normal addresses alone', () => {
    expect(normalizeEmail('person@example.com')).toBe('person@example.com');
  });

  it('strips unicode whitespace the same way String.trim does', () => {
    expect(normalizeEmail('\u00A0person@example.com\uFEFF')).toBe('person@example.com');
  });
});
