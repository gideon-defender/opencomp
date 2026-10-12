import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  memberFindFirst: vi.fn(),
  policyFindUnique: vi.fn(),
  policyUpdate: vi.fn(),
  completionUpsert: vi.fn(),
  getSignedUrl: vi.fn(),
  revoked: false,
}));
vi.mock('@/app/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('@/env.mjs', () => ({ env: {} }));
vi.mock('@/utils/s3', () => ({
  BUCKET_NAME: 'policies',
  s3Client: {},
  getSignedUrl: mocks.getSignedUrl,
}));
vi.mock('@db/server', () => ({
  db: {
    member: { findFirst: mocks.memberFindFirst },
    policy: { findUnique: mocks.policyFindUnique, update: mocks.policyUpdate },
    employeeTrainingVideoCompletion: { upsert: mocks.completionUpsert },
    organization: { findUnique: vi.fn().mockResolvedValue({ id: 'org_1' }) },
  },
}));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}));

import { validateMemberAndOrg } from '../download-agent/utils';
import { POST as acceptPolicies } from './accept-policies/route';
import { POST as completeTraining } from './complete-training/route';
import { POST as markPolicyCompleted } from './mark-policy-completed/route';
import { GET as downloadPolicy } from './policy-pdf-url/route';

const member = { id: 'mem_1', userId: 'user_1', organizationId: 'org_1', role: 'employee' };

function request({ path, body }: { path: string; body?: unknown }) {
  return new NextRequest(
    `http://localhost/api/portal/${path}`,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
}

describe('portal access after IdP revocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.revoked = false;
    mocks.getSession.mockResolvedValue({ user: { id: 'user_1' } });
    mocks.memberFindFirst.mockImplementation(
      ({
        where,
      }: {
        where: { idpAccessRevoked?: boolean; organizationId?: string; id?: string };
      }) =>
        Promise.resolve(
          (mocks.revoked && where.idpAccessRevoked === false) ||
            (where.organizationId && where.organizationId !== 'org_1')
            ? null
            : member,
        ),
    );
    mocks.policyFindUnique.mockResolvedValue({
      id: 'pol_1',
      organizationId: 'org_1',
      pdfUrl: 'policy.pdf',
      signedBy: [],
    });
    mocks.getSignedUrl.mockResolvedValue('https://download.test/policy');
    mocks.completionUpsert.mockResolvedValue({ id: 'completion', completedAt: new Date() });
  });

  it('blocks policy downloads with the same cookie after revocation', async () => {
    const req = request({ path: 'policy-pdf-url?policyId=pol_1' });
    expect(await (await downloadPolicy(req)).json()).toMatchObject({ success: true });
    mocks.getSignedUrl.mockClear();
    mocks.revoked = true;
    expect(await (await downloadPolicy(req)).json()).toMatchObject({ success: false });
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
  });

  it('blocks training writes with an existing session after revocation', async () => {
    mocks.revoked = true;
    const res = await completeTraining(
      request({
        path: 'complete-training',
        body: { videoId: 'sat-1', organizationId: 'org_1' },
      }),
    );
    expect(res.status).toBe(403);
    expect(mocks.completionUpsert).not.toHaveBeenCalled();
  });

  it.each([
    {
      path: 'accept-policies',
      handler: acceptPolicies,
      body: { policyIds: ['pol_1'], memberId: 'mem_1' },
    },
    { path: 'mark-policy-completed', handler: markPolicyCompleted, body: { policyId: 'pol_1' } },
  ])('blocks $path after revocation', async ({ path, handler, body }) => {
    mocks.revoked = true;
    expect((await handler(request({ path, body }))).status).toBeGreaterThanOrEqual(400);
    expect(mocks.policyUpdate).not.toHaveBeenCalled();
  });

  it('blocks Fleet access to a revoked membership but retains other tenants', async () => {
    expect(await validateMemberAndOrg('user_1', 'org_1')).toEqual(member);
    mocks.revoked = true;
    expect(await validateMemberAndOrg('user_1', 'org_1')).toBeNull();
    mocks.memberFindFirst.mockResolvedValue({ ...member, organizationId: 'org_2' });
    expect(await validateMemberAndOrg('user_1', 'org_2')).toMatchObject({
      organizationId: 'org_2',
    });
  });
});
