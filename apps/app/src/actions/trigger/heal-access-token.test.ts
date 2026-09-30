import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  createToken: vi.fn(),
  set: vi.fn(),
  getSession: vi.fn(),
  findOnboarding: vi.fn(),
  findKnowledgeBaseDocument: vi.fn(),
  findRemediationBatch: vi.fn(),
}));

vi.mock('@gideon-defender/trigger-local', () => ({
  runs: { retrieve: mocks.retrieve },
  auth: { createPublicToken: mocks.createToken },
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: mocks.set }),
  headers: async () => new Headers(),
}));
vi.mock('@/utils/auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock('@db/server', () => ({
  db: {
    onboarding: { findFirst: mocks.findOnboarding },
    knowledgeBaseDocument: { findFirst: mocks.findKnowledgeBaseDocument },
    remediationBatch: { findFirst: mocks.findRemediationBatch },
  },
}));

import { healAndSetAccessToken } from './heal-access-token';

describe('tracking token recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.retrieve.mockResolvedValue({ id: 'run_current' });
    mocks.createToken.mockResolvedValue('public_new');
    mocks.getSession.mockResolvedValue({
      session: { activeOrganizationId: 'org_1' },
    });
    mocks.findOnboarding.mockResolvedValue(null);
    mocks.findKnowledgeBaseDocument.mockResolvedValue(null);
    mocks.findRemediationBatch.mockResolvedValue(null);
  });

  it('issues and saves a token when the run belongs to an onboarding job in the caller org', async () => {
    mocks.findOnboarding.mockResolvedValue({ organizationId: 'org_1' });

    expect(await healAndSetAccessToken('run_current')).toBe('public_new');
    expect(mocks.retrieve).toHaveBeenCalledWith('run_current');
    expect(mocks.createToken).toHaveBeenCalledWith({ scopes: { read: { runs: ['run_current'] } } });
    expect(mocks.set).toHaveBeenCalledWith('publicAccessToken', 'public_new');
  });

  it('issues a token when the run belongs to a knowledge base document in the caller org', async () => {
    mocks.findKnowledgeBaseDocument.mockResolvedValue({ id: 'kbd_1' });

    expect(await healAndSetAccessToken('run_current')).toBe('public_new');
    expect(mocks.set).toHaveBeenCalledWith('publicAccessToken', 'public_new');
  });

  it('issues a token when the run belongs to a remediation batch in the caller org', async () => {
    mocks.findRemediationBatch.mockResolvedValue({ id: 'rmb_1' });

    expect(await healAndSetAccessToken('run_current')).toBe('public_new');
    expect(mocks.set).toHaveBeenCalledWith('publicAccessToken', 'public_new');
  });

  it('does not issue a token for a missing run', async () => {
    mocks.retrieve.mockRejectedValue(new Error('Run not found'));
    mocks.findOnboarding.mockResolvedValue({ organizationId: 'org_1' });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await healAndSetAccessToken('run_missing')).toBeNull();
    expect(mocks.createToken).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('returns null and never mints a token when there is no authenticated session', async () => {
    mocks.getSession.mockResolvedValue(null);

    expect(await healAndSetAccessToken('run_current')).toBeNull();
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.createToken).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('returns null and never mints a token when the session has no active organization', async () => {
    mocks.getSession.mockResolvedValue({ session: { activeOrganizationId: null } });

    expect(await healAndSetAccessToken('run_current')).toBeNull();
    expect(mocks.createToken).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('refuses to mint a token for a run owned by a different organization (cross-tenant)', async () => {
    // Run exists, but not under the caller's org — all ownership lookups miss.
    expect(await healAndSetAccessToken('run_other_org')).toBeNull();
    expect(mocks.findOnboarding).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', triggerJobId: 'run_other_org' },
      select: { organizationId: true },
    });
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.createToken).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
