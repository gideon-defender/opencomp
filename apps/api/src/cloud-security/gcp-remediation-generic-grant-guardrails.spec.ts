import { validateGcpGenericPublicGrant } from './gcp-remediation-generic-grant-guardrails';

const PREFIX = 'Step 1 (PATCH /datasets/d)';
const DATASET_URL =
  'https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets/d';

function check(
  body: Record<string, unknown>,
  args?: {
    queryParams?: Record<string, unknown>;
    isRollback?: boolean;
    realState?: Record<string, unknown>;
  },
) {
  return validateGcpGenericPublicGrant(
    {
      method: 'PATCH',
      url: DATASET_URL,
      body,
      ...(args?.queryParams ? { queryParams: args.queryParams } : {}),
    },
    body,
    PREFIX,
    {
      ...(args?.isRollback ? { isRollback: true } : {}),
      ...(args?.realState ? { realState: args.realState } : {}),
    },
  );
}

describe('validateGcpGenericPublicGrant', () => {
  it('refuses a public dataset grant via specialGroup', () => {
    const errors = check({
      access: [{ specialGroup: 'allAuthenticatedUsers' }],
    });
    expect(errors.join(' ')).toMatch(/public/);
  });

  it('refuses a whole-domain dataset grant (reads as public)', () => {
    const errors = check({
      access: [{ role: 'READER', domain: 'evil.example' }],
    });
    expect(errors.join(' ')).toMatch(/public/);
  });

  it('refuses a privileged role grant to a single address', () => {
    const errors = check({
      access: [{ role: 'roles/owner', userByEmail: 'mallory@evil.example' }],
    });
    expect(errors.join(' ')).toMatch(/privileged role/);
  });

  it('refuses a single-principal data-role grant regardless of case', () => {
    for (const role of [
      'READER',
      'reader',
      'roles/bigquery.dataViewer',
      'ROLES/BIGQUERY.DATAEDITOR',
    ]) {
      const errors = check({
        access: [{ role, userByEmail: 'mallory@evil.example' }],
      });
      expect(errors.join(' ')).toMatch(/single identity/);
    }
  });

  it('refuses a data-role grant nested under an arbitrary key', () => {
    const errors = check({
      wrapped: { access: [{ role: 'READER', userByEmail: 'x@evil.example' }] },
    });
    expect(errors.join(' ')).toMatch(/single identity/);
  });

  it('refuses a new authorized-view share but keeps retained ones', () => {
    const retained = { view: { projectId: 'p', datasetId: 'd', tableId: 'v' } };
    const errors = check(
      { access: [retained, { view: { projectId: 'evil', datasetId: 'x' } }] },
      { realState: { read: { access: [retained] } } },
    );
    expect(errors.join(' ')).toMatch(/new share/);
  });

  it('allows a resend of only retained shares', () => {
    const retained = { view: { projectId: 'p', datasetId: 'd', tableId: 'v' } };
    const errors = check(
      { access: [retained] },
      { realState: { read: { access: [retained] } } },
    );
    expect(errors).toEqual([]);
  });

  it('refuses a privileged role smuggled in queryParams', () => {
    const errors = check({}, { queryParams: { role: 'roles/owner' } });
    expect(errors.join(' ')).toMatch(/query param/);
  });

  it('refuses a public member smuggled in queryParams', () => {
    const errors = check({}, { queryParams: { members: 'allUsers' } });
    expect(errors.join(' ')).toMatch(/query param/);
  });

  it('refuses a single-principal grant via the iamMember shape', () => {
    for (const iamMember of [
      'user:mallory@evil.example',
      'group:eng@evil.example',
      'domain:evil.example',
      'serviceAccount:sa@evil.example',
    ]) {
      const errors = check({
        access: [{ role: 'READER', iamMember }],
      });
      expect(errors.join(' ')).toMatch(/single identity/);
    }
  });

  it('skips the single-principal refusal on the rollback path', () => {
    const errors = check(
      { access: [{ role: 'READER', userByEmail: 'mallory@evil.example' }] },
      { isRollback: true },
    );
    expect(errors).toEqual([]);
  });
});
