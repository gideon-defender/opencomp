import { describe, expect, it } from 'vitest';
import { getInitials } from './format';

describe('getInitials', () => {
  it('derives initials from the first two words', () => {
    expect(getInitials('Acme Corp')).toBe('AC');
  });

  it('derives a single initial from a single-word name', () => {
    expect(getInitials('Madonna')).toBe('M');
  });

  it('caps initials at two words for long names', () => {
    expect(getInitials('John Ronald Reuel')).toBe('JR');
  });

  it('returns a placeholder for a blank name', () => {
    expect(getInitials('   ')).toBe('?');
    expect(getInitials('')).toBe('?');
  });

  it('handles unicode names without splitting surrogates', () => {
    expect(getInitials('Élodie François')).toBe('ÉF');
  });
});
