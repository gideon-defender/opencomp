import { canonicalDocument } from './public-document';

describe('public spec canonicalization', () => {
  it('ignores object key order but retains nested schema constraints and route changes', () => {
    expect(canonicalDocument({ b: 2, a: { x: 1, y: 2 } })).toBe(
      canonicalDocument({ a: { y: 2, x: 1 }, b: 2 }),
    );
    expect(canonicalDocument({ schema: { minimum: 1 } })).not.toBe(
      canonicalDocument({ schema: { minimum: 2 } }),
    );
    expect(canonicalDocument({ paths: { '/v1/tasks': {} } })).not.toBe(
      canonicalDocument({ paths: { '/v1/other': {} } }),
    );
  });
  it('does not reorder arrays or drop null and optional-looking properties', () => {
    expect(canonicalDocument({ values: ['a', 'b'] })).not.toBe(
      canonicalDocument({ values: ['b', 'a'] }),
    );
    expect(canonicalDocument({ value: null })).not.toBe(canonicalDocument({}));
    expect(canonicalDocument({ additionalProperties: false })).not.toBe(
      canonicalDocument({}),
    );
  });
});
