import { validateGcpSetIamPolicy } from './gcp-remediation-iam-guardrails';

const PREFIX = 'Step 1 (POST /projects/p:setIamPolicy)';
const SET_URL =
  'https://cloudresourcemanager.googleapis.com/v3/projects/p:setIamPolicy';
const GET_URL =
  'https://cloudresourcemanager.googleapis.com/v3/projects/p:getIamPolicy';

const PRIOR = {
  bindings: [{ role: 'roles/viewer', members: ['alice@example.com'] }],
  etag: 'e1',
  version: 1,
};

function check(
  policy: Record<string, unknown>,
  state: Record<string, unknown> | undefined = { read: { ...PRIOR } },
) {
  return validateGcpSetIamPolicy({ policy }, state, PREFIX, {
    readSteps: [{ purpose: 'read', url: GET_URL }],
    fixStep: { url: SET_URL },
  });
}

describe('validateGcpSetIamPolicy', () => {
  it('accepts a strict removal of a public binding', () => {
    const errors = check(
      { ...PRIOR, bindings: [...PRIOR.bindings] },
      {
        read: {
          ...PRIOR,
          bindings: [
            ...PRIOR.bindings,
            { role: 'roles/viewer', members: ['allUsers'] },
          ],
        },
      },
    );
    expect(errors).toEqual([]);
  });

  it('refuses changes to auditConfigs present in read state', () => {
    const errors = check(
      {
        ...PRIOR,
        auditConfigs: [
          { service: 'allServices', auditLogConfigs: [{ logType: 'DATA_READ' }] },
        ],
      },
      {
        read: {
          ...PRIOR,
          auditConfigs: [
            { service: 'allServices', auditLogConfigs: [{ logType: 'ADMIN_READ' }] },
          ],
        },
      },
    );
    expect(errors.join(' ')).toMatch(/auditConfigs/);
  });

  it('refuses newly introduced auditConfigs hiding actors', () => {
    const errors = check({
      ...PRIOR,
      auditConfigs: [
        {
          service: 'allServices',
          auditLogConfigs: [
            {
              logType: 'ADMIN_READ',
              exemptedMembers: ['mallory@evil.example'],
            },
          ],
        },
      ],
    });
    expect(errors.join(' ')).toMatch(/exemptedMembers/);
  });

  it('refuses an etag that does not match read state', () => {
    const errors = check({ ...PRIOR, etag: 'forged' });
    expect(errors.join(' ')).toMatch(/etag does not match/);
  });

  it('refuses a same-length binding swap (privilege escalation)', () => {
    const errors = check({
      ...PRIOR,
      bindings: [{ role: 'roles/editor', members: ['mallory@evil.example'] }],
    });
    expect(errors.join(' ')).toMatch(/adds or changes a binding/);
  });

  it('refuses an additive grant that keeps existing bindings', () => {
    const errors = check({
      ...PRIOR,
      bindings: [
        ...PRIOR.bindings,
        { role: 'roles/editor', members: ['mallory@evil.example'] },
      ],
    });
    expect(errors.join(' ')).toMatch(/adds or changes a binding/);
  });

  it('refuses setIamPolicy without read state', () => {
    const errors = validateGcpSetIamPolicy(
      { policy: { ...PRIOR } },
      undefined,
      PREFIX,
      {
        readSteps: [{ purpose: 'read', url: GET_URL }],
        fixStep: { url: SET_URL },
      },
    );
    expect(errors.join(' ')).toMatch(/without read state/);
  });

  it('refuses a body without a policy object', () => {
    const errors = validateGcpSetIamPolicy({}, { read: { ...PRIOR } }, PREFIX, {
      readSteps: [{ purpose: 'read', url: GET_URL }],
      fixStep: { url: SET_URL },
    });
    expect(errors.join(' ')).toMatch(/must carry the full "policy" object/);
  });
});
