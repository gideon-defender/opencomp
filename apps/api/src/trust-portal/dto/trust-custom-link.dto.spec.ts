import {
  CreateCustomLinkSchema,
  UpdateCustomLinkSchema,
} from './trust-custom-link.dto';

describe('custom link URL scheme allow-list', () => {
  it('accepts http and https URLs', () => {
    expect(
      CreateCustomLinkSchema.safeParse({
        title: 'Status',
        url: 'https://status.example.com',
      }).success,
    ).toBe(true);
  });

  it('rejects javascript: URLs on create and update', () => {
    expect(
      CreateCustomLinkSchema.safeParse({
        title: 'X',
        url: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
    expect(
      UpdateCustomLinkSchema.safeParse({ url: 'javascript:alert(1)' }).success,
    ).toBe(false);
  });

  it('rejects data: URLs', () => {
    expect(
      CreateCustomLinkSchema.safeParse({
        title: 'X',
        url: 'data:text/html,hi',
      }).success,
    ).toBe(false);
  });
});
