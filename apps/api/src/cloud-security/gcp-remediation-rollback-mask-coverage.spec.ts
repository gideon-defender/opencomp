import { validateMaskExternalBodyKeys } from './gcp-remediation-rollback-mask-coverage';

const PREFIX = 'Step 1 (PATCH /b)';

function args(overrides: Record<string, unknown> = {}) {
  return {
    body: {},
    fields: [],
    prefix: PREFIX,
    method: 'PATCH',
    ...overrides,
  } as Parameters<typeof validateMaskExternalBodyKeys>[0];
}

describe('validateMaskExternalBodyKeys', () => {
  it('passes when every body key sits inside the mask', () => {
    expect(
      validateMaskExternalBodyKeys(args({ body: { a: 1 }, fields: ['a'] })),
    ).toEqual([]);
  });

  it('passes a mask-external leaf covered by an ancestor field', () => {
    // A mask entry names a subtree: leaves under it already proved equal.
    expect(
      validateMaskExternalBodyKeys(
        args({ body: { a: { b: 1 } }, fields: ['a'] }),
      ),
    ).toEqual([]);
  });

  it('passes a mask-external leaf equal to its pre-fix value', () => {
    expect(
      validateMaskExternalBodyKeys(
        args({
          body: { config: { retention: 'on' } },
          fields: ['other'],
          previousState: { read: { config: { retention: 'on' } } },
        }),
      ),
    ).toEqual([]);
  });

  it('refuses a mask-external leaf that differs from pre-fix state', () => {
    const errors = validateMaskExternalBodyKeys(
      args({
        body: { config: { retention: 'off' } },
        fields: ['other'],
        previousState: { read: { config: { retention: 'on' } } },
      }),
    );
    expect(errors.join(' ')).toMatch(/outside updateMask.*no matching pre-fix/);
  });

  it('refuses a mask-external leaf with no pre-fix state at all', () => {
    const errors = validateMaskExternalBodyKeys(
      args({ body: { extra: true }, fields: ['a'] }),
    );
    expect(errors.join(' ')).toMatch(/no matching pre-fix value/);
  });

  it('fails closed on bodies too deep to verify', () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 14; i++) deep = { nested: deep };
    const errors = validateMaskExternalBodyKeys(
      args({
        body: deep,
        fields: ['a'],
        previousState: { read: { nested: {} } },
      }),
    );
    expect(errors.join(' ')).toMatch(/too complex to verify/);
  });
});
