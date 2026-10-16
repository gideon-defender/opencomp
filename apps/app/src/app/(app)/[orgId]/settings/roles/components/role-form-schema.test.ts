import { describe, expect, it } from 'vitest';
import { roleFormSchema } from './RoleForm';

describe('roleFormSchema', () => {
  it('validates correct role names', () => {
    // Note: name must be at least 2 characters per schema
    // Now allows uppercase, spaces, letters, numbers, and hyphens
    const validNames = [
      'compliance-lead',
      'role1',
      'ab',
      'my-role-123',
      'test',
      'Compliance Lead',
      'Risk Manager',
      'IT-Support',
    ];

    for (const name of validNames) {
      const result = roleFormSchema.safeParse({
        name,
        permissions: { control: ['read'] },
        obligations: {},
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid role names', () => {
    const invalidNames = [
      '123-starts-with-number',
      'has_underscore',
      '', // empty
      'a'.repeat(51), // too long
      ' starts-with-space',
    ];

    for (const name of invalidNames) {
      const result = roleFormSchema.safeParse({
        name,
        permissions: { control: ['read'] },
        obligations: {},
      });
      expect(result.success).toBe(false);
    }
  });

  it('rejects empty permissions', () => {
    const result = roleFormSchema.safeParse({
      name: 'valid-role',
      permissions: {},
      obligations: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects permissions with only empty arrays', () => {
    const result = roleFormSchema.safeParse({
      name: 'valid-role',
      permissions: { control: [] },
      obligations: {},
    });
    expect(result.success).toBe(false);
  });
});
