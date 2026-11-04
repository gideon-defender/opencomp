import {
  isValidAzureSubscriptionId,
  normalizeAzureSubscriptionId,
} from './azure-ids';

describe('azure-ids', () => {
  const VALID = '12345678-1234-1234-1234-123456789012';

  it('accepts a well-formed GUID', () => {
    expect(isValidAzureSubscriptionId(VALID)).toBe(true);
    expect(normalizeAzureSubscriptionId(VALID)).toBe(VALID);
  });

  it('accepts an uppercase GUID', () => {
    expect(isValidAzureSubscriptionId(VALID.toUpperCase())).toBe(true);
  });

  it.each([
    ['path traversal', '../12345678-1234-1234-1234-123456789012'],
    ['extra segment', `${VALID}/providers`],
    ['query injection', `${VALID}?x=1`],
    ['not a guid', 'not-a-guid'],
    ['empty', ''],
    ['number', 42],
    ['null', null],
    ['undefined', undefined],
    ['object', {}],
  ])('rejects %s', (_label, value) => {
    expect(isValidAzureSubscriptionId(value)).toBe(false);
    expect(normalizeAzureSubscriptionId(value)).toBeNull();
  });
});
