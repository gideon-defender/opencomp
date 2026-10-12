import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  memberFindFirst: vi.fn(),
  frameworkInstanceFindFirst: vi.fn(),
  completionUpsert: vi.fn(),
  completionUpdate: vi.fn(),
  completionFindMany: vi.fn(),
  logger: vi.fn(),
  fetch: vi.fn(),
  afterTasks: [] as Array<() => unknown>,
  env: {
    SERVICE_TOKEN_PORTAL: undefined as string | undefined,
    NEXT_PUBLIC_API_URL: 'http://api.test',
  },
}));

vi.mock('@/app/lib/auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
}));

vi.mock('@db/server', () => ({
  db: {
    member: { findFirst: mocks.memberFindFirst },
    frameworkInstance: { findFirst: mocks.frameworkInstanceFindFirst },
    employeeTrainingVideoCompletion: {
      upsert: mocks.completionUpsert,
      update: mocks.completionUpdate,
      findMany: mocks.completionFindMany,
    },
  },
}));

vi.mock('@/env.mjs', () => ({ env: mocks.env }));
vi.mock('@/utils/logger', () => ({ logger: mocks.logger }));
vi.stubGlobal('fetch', mocks.fetch);

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (task: () => unknown) => {
      mocks.afterTasks.push(task);
    },
  };
});

/** Runs whatever the route deferred, mimicking Next flushing `after` tasks. */
async function flushAfterTasks(): Promise<void> {
  await Promise.all(mocks.afterTasks.splice(0).map((task) => task()));
}

import { POST } from './route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/portal/complete-training', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(raw: string): NextRequest {
  return new NextRequest('http://localhost/api/portal/complete-training', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw,
  });
}

function mockMember(role: string) {
  mocks.memberFindFirst.mockResolvedValue({
    id: 'mem_1',
    userId: 'user_1',
    organizationId: 'org_1',
    role,
    deactivated: false,
  });
}

describe('POST /api/portal/complete-training', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterTasks.length = 0;
    mocks.env.SERVICE_TOKEN_PORTAL = undefined;
  });

  it('returns 401 when there is no session', async () => {
    mocks.getSession.mockResolvedValue(null);

    const res = await POST(makeRequest({ videoId: 'sat-1', organizationId: 'org_1' }));

    expect(res.status).toBe(401);
    expect(mocks.completionUpsert).not.toHaveBeenCalled();
  });

  it('returns 400 when the request body is not valid JSON', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user_1' } });

    const res = await POST(makeRawRequest('{ not: valid json'));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid request body');
    expect(mocks.memberFindFirst).not.toHaveBeenCalled();
    expect(mocks.completionUpsert).not.toHaveBeenCalled();
  });

  it('returns 403 when the user is not a member of the organization', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user_1' } });
    mocks.memberFindFirst.mockResolvedValue(null);

    const res = await POST(makeRequest({ videoId: 'sat-1', organizationId: 'org_1' }));

    expect(res.status).toBe(403);
    expect(mocks.completionUpsert).not.toHaveBeenCalled();
  });

  it('marks training complete for a member whose role lacks portal:update', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user_1' } });
    mockMember('custom-role-without-portal-update');
    const record = {
      id: 'etvc_1',
      videoId: 'sat-1',
      memberId: 'mem_1',
      completedAt: new Date('2026-07-24T00:00:00.000Z'),
    };
    mocks.completionUpsert.mockResolvedValue(record);

    const res = await POST(makeRequest({ videoId: 'sat-1', organizationId: 'org_1' }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.id).toBe('etvc_1');

    expect(mocks.memberFindFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        organizationId: 'org_1',
        deactivated: false,
        idpAccessRevoked: false,
      },
    });
    expect(mocks.completionUpsert).toHaveBeenCalledWith({
      where: { memberId_videoId: { memberId: 'mem_1', videoId: 'sat-1' } },
      create: expect.objectContaining({ videoId: 'sat-1', memberId: 'mem_1' }),
      update: {},
    });
  });

  it('does not re-stamp an already completed video', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user_1' } });
    mockMember('employee');
    mocks.completionUpsert.mockResolvedValue({
      id: 'etvc_1',
      videoId: 'sat-1',
      memberId: 'mem_1',
      completedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const res = await POST(makeRequest({ videoId: 'sat-1', organizationId: 'org_1' }));

    expect(res.status).toBe(200);
    expect(mocks.completionUpdate).not.toHaveBeenCalled();
  });

  it('stamps a pre-existing record whose completedAt is still null', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user_1' } });
    mockMember('employee');
    mocks.completionUpsert.mockResolvedValue({
      id: 'etvc_1',
      videoId: 'sat-1',
      memberId: 'mem_1',
      completedAt: null,
    });
    mocks.completionUpdate.mockResolvedValue({
      id: 'etvc_1',
      videoId: 'sat-1',
      memberId: 'mem_1',
      completedAt: new Date('2026-07-24T00:00:00.000Z'),
    });

    const res = await POST(makeRequest({ videoId: 'sat-1', organizationId: 'org_1' }));

    expect(res.status).toBe(200);
    expect(mocks.completionUpdate).toHaveBeenCalledWith({
      where: { id: 'etvc_1' },
      data: expect.objectContaining({ completedAt: expect.any(Date) }),
    });
  });

  it('rejects an unknown video ID', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user_1' } });

    const res = await POST(makeRequest({ videoId: 'not-a-real-video', organizationId: 'org_1' }));

    expect(res.status).toBe(400);
    expect(mocks.memberFindFirst).not.toHaveBeenCalled();
  });

  it('rejects hipaa-sat-1 when the org does not have the HIPAA framework', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user_1' } });
    mockMember('employee');
    mocks.frameworkInstanceFindFirst.mockResolvedValue(null);

    const res = await POST(makeRequest({ videoId: 'hipaa-sat-1', organizationId: 'org_1' }));

    expect(res.status).toBe(400);
    expect(mocks.frameworkInstanceFindFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', framework: { name: 'HIPAA' } },
      select: { id: true },
    });
    expect(mocks.completionUpsert).not.toHaveBeenCalled();
  });

  it('marks hipaa-sat-1 complete when the org has the HIPAA framework', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user_1' } });
    mockMember('employee');
    mocks.frameworkInstanceFindFirst.mockResolvedValue({ id: 'frm_1' });
    const record = {
      id: 'etvc_hipaa',
      videoId: 'hipaa-sat-1',
      memberId: 'mem_1',
      completedAt: new Date('2026-07-24T00:00:00.000Z'),
    };
    mocks.completionUpsert.mockResolvedValue(record);

    const res = await POST(makeRequest({ videoId: 'hipaa-sat-1', organizationId: 'org_1' }));

    expect(res.status).toBe(200);
    expect(mocks.completionUpsert).toHaveBeenCalledWith({
      where: { memberId_videoId: { memberId: 'mem_1', videoId: 'hipaa-sat-1' } },
      create: expect.objectContaining({ videoId: 'hipaa-sat-1', memberId: 'mem_1' }),
      update: {},
    });
  });

  it('logs when the completion email request returns a non-2xx response', async () => {
    mocks.env.SERVICE_TOKEN_PORTAL = 'svc-token';
    mocks.getSession.mockResolvedValue({ user: { id: 'user_1' } });
    mockMember('employee');
    mocks.frameworkInstanceFindFirst.mockResolvedValue({ id: 'frm_1' });
    mocks.completionUpsert.mockResolvedValue({
      id: 'etvc_hipaa',
      videoId: 'hipaa-sat-1',
      memberId: 'mem_1',
      completedAt: new Date('2026-07-24T00:00:00.000Z'),
    });
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(makeRequest({ videoId: 'hipaa-sat-1', organizationId: 'org_1' }));

    expect(res.status).toBe(200);
    expect(mocks.fetch).not.toHaveBeenCalled();

    await flushAfterTasks();

    expect(mocks.fetch).toHaveBeenCalledWith(
      'http://api.test/v1/training/send-hipaa-completion-email',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'Error triggering training completion email',
      expect.objectContaining({ memberId: 'mem_1' }),
    );

    errorSpy.mockRestore();
  });
});
