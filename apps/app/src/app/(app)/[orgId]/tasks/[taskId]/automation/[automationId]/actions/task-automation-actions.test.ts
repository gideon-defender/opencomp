import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUniqueAutomation: vi.fn(),
  revalidatePath: vi.fn(),
  serverApiPatch: vi.fn(),
  serverApiPost: vi.fn(),
  kvGet: vi.fn(),
  kvSet: vi.fn(),
}));

vi.mock('@/utils/auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock('@db/server', () => ({
  db: {
    evidenceAutomation: { findUnique: mocks.findUniqueAutomation },
  },
}));
vi.mock('@gideon-defender/kv', () => ({
  client: { get: mocks.kvGet, set: mocks.kvSet },
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));
vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock('@/lib/api-server', () => ({
  serverApi: { patch: mocks.serverApiPatch, post: mocks.serverApiPost },
}));

import {
  analyzeAutomationWorkflow,
  executeAutomationScript,
  getAutomationRunStatus,
  getAutomationScript,
  listAutomationScripts,
  loadChatHistory,
  publishAutomation,
  restoreVersion,
  saveChatHistory,
  toggleAutomationEnabled,
  updateEvaluationCriteria,
  uploadAutomationScript,
} from './task-automation-actions';

const ORG = 'org_1';
const OTHER_ORG = 'org_attacker';

function mockFetchOk(body: unknown = { success: true }) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
    }),
  );
}

describe('task-automation-actions — session and ownership guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    process.env.ENTERPRISE_API_SECRET = 'test-secret';
    process.env.NEXT_PUBLIC_ENTERPRISE_API_URL = 'https://enterprise.internal';
    mocks.getSession.mockResolvedValue({ session: { activeOrganizationId: ORG } });
    mocks.kvGet.mockResolvedValue(null);
    mocks.kvSet.mockResolvedValue('OK');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('uploadAutomationScript', () => {
    it('rejects when there is no authenticated session', async () => {
      mocks.getSession.mockResolvedValue(null);

      const result = await uploadAutomationScript({
        orgId: ORG,
        taskId: 'tsk_1',
        content: 'echo hi',
      });

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects when the caller supplies a different org than their session (cross-tenant)', async () => {
      const result = await uploadAutomationScript({
        orgId: OTHER_ORG,
        taskId: 'tsk_1',
        content: 'echo hi',
      });

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('proceeds when the org matches the session', async () => {
      mockFetchOk({ success: true, data: { key: 'script-key' } });

      const result = await uploadAutomationScript({
        orgId: ORG,
        taskId: 'tsk_1',
        content: 'echo hi',
      });

      expect(result.success).toBe(true);
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('getAutomationScript', () => {
    it('rejects when there is no authenticated session', async () => {
      mocks.getSession.mockResolvedValue(null);

      const result = await getAutomationScript(`${ORG}/tsk_1/aut_1.js`);

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects a key scoped to a different organization', async () => {
      const result = await getAutomationScript(`${OTHER_ORG}/tsk_1/aut_1.js`);

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects a key containing path traversal segments', async () => {
      const result = await getAutomationScript(`${ORG}/../${OTHER_ORG}/aut_1.js`);

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('proceeds when the key is scoped to the caller org', async () => {
      mockFetchOk({ success: true, data: 'contents' });

      const result = await getAutomationScript(`${ORG}/tsk_1/aut_1.js`);

      expect(result.success).toBe(true);
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('listAutomationScripts', () => {
    it('rejects an org that does not match the session', async () => {
      const result = await listAutomationScripts(OTHER_ORG);

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('proceeds when the org matches the session', async () => {
      mockFetchOk({ success: true, data: [] });

      const result = await listAutomationScripts(ORG);

      expect(result.success).toBe(true);
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('executeAutomationScript', () => {
    it('rejects an org that does not match the session', async () => {
      const result = await executeAutomationScript({
        orgId: OTHER_ORG,
        taskId: 'tsk_1',
        automationId: 'aut_1',
      });

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('proceeds when the org matches the session', async () => {
      mockFetchOk({ success: true, data: { runId: 'run_1' } });

      const result = await executeAutomationScript({
        orgId: ORG,
        taskId: 'tsk_1',
        automationId: 'aut_1',
      });

      expect(result.success).toBe(true);
      expect(fetch).toHaveBeenCalled();
      expect(mocks.kvSet).toHaveBeenCalledWith(
        'app:automation-run-owner:run_1',
        ORG,
        expect.objectContaining({ ex: expect.any(Number) }),
      );
    });
  });

  describe('analyzeAutomationWorkflow', () => {
    it('rejects when there is no authenticated session', async () => {
      mocks.getSession.mockResolvedValue(null);

      const result = await analyzeAutomationWorkflow('echo hi');

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('proceeds for an authenticated session', async () => {
      mockFetchOk({ success: true, data: {} });

      const result = await analyzeAutomationWorkflow('echo hi');

      expect(result.success).toBe(true);
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('getAutomationRunStatus', () => {
    it('rejects when there is no authenticated session', async () => {
      mocks.getSession.mockResolvedValue(null);

      const result = await getAutomationRunStatus('run_1');

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects a run owned by a different organization (IDOR)', async () => {
      mocks.kvGet.mockResolvedValue(OTHER_ORG);

      const result = await getAutomationRunStatus('run_1');

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects a run with no recorded owner', async () => {
      mocks.kvGet.mockResolvedValue(null);

      const result = await getAutomationRunStatus('run_1');

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('proceeds for a run owned by the caller organization', async () => {
      mocks.kvGet.mockResolvedValue(ORG);
      mockFetchOk({ success: true, data: { status: 'RUNNING' } });

      const result = await getAutomationRunStatus('run_1');

      expect(result.success).toBe(true);
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('loadChatHistory', () => {
    it('rejects when there is no authenticated session', async () => {
      mocks.getSession.mockResolvedValue(null);

      const result = await loadChatHistory('aut_1');

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(mocks.findUniqueAutomation).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects when the automation belongs to a different organization (IDOR)', async () => {
      mocks.findUniqueAutomation.mockResolvedValue({
        task: { organizationId: OTHER_ORG },
      });

      const result = await loadChatHistory('aut_1');

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects when the automation does not exist', async () => {
      mocks.findUniqueAutomation.mockResolvedValue(null);

      const result = await loadChatHistory('aut_1');

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('proceeds when the automation belongs to the caller organization', async () => {
      mocks.findUniqueAutomation.mockResolvedValue({
        task: { organizationId: ORG },
      });
      mockFetchOk({ success: true, data: { messages: [], total: 0, hasMore: false } });

      const result = await loadChatHistory('aut_1');

      expect(result.success).toBe(true);
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('saveChatHistory', () => {
    it('rejects when the automation belongs to a different organization (IDOR)', async () => {
      mocks.findUniqueAutomation.mockResolvedValue({
        task: { organizationId: OTHER_ORG },
      });

      const result = await saveChatHistory('aut_1', []);

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('proceeds when the automation belongs to the caller organization', async () => {
      mocks.findUniqueAutomation.mockResolvedValue({
        task: { organizationId: ORG },
      });
      mockFetchOk({ success: true });

      const result = await saveChatHistory('aut_1', []);

      expect(result).toEqual({ success: true });
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('publishAutomation', () => {
    it('rejects an org that does not match the session', async () => {
      const result = await publishAutomation(OTHER_ORG, 'tsk_1', 'aut_1');

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.serverApiPost).not.toHaveBeenCalled();
    });

    it('proceeds when the org matches the session', async () => {
      mockFetchOk({ success: true, version: 2, scriptKey: 'key' });
      mocks.serverApiPost.mockResolvedValue({
        data: { success: true, version: { version: 2 } },
      });

      const result = await publishAutomation(ORG, 'tsk_1', 'aut_1');

      expect(result.success).toBe(true);
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('restoreVersion', () => {
    it('rejects an org that does not match the session', async () => {
      const result = await restoreVersion(OTHER_ORG, 'tsk_1', 'aut_1', 1);

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('proceeds when the org matches the session', async () => {
      mockFetchOk({ success: true });

      const result = await restoreVersion(ORG, 'tsk_1', 'aut_1', 1);

      expect(result).toEqual({ success: true });
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('updateEvaluationCriteria', () => {
    it('rejects when there is no authenticated session', async () => {
      mocks.getSession.mockResolvedValue(null);

      const result = await updateEvaluationCriteria('tsk_1', 'aut_1', 'criteria');

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(mocks.serverApiPatch).not.toHaveBeenCalled();
    });

    it('proceeds for an authenticated session', async () => {
      mocks.serverApiPatch.mockResolvedValue({ data: {} });

      const result = await updateEvaluationCriteria('tsk_1', 'aut_1', 'criteria');

      expect(result).toEqual({ success: true });
      expect(mocks.serverApiPatch).toHaveBeenCalled();
    });
  });

  describe('toggleAutomationEnabled', () => {
    it('rejects when there is no authenticated session', async () => {
      mocks.getSession.mockResolvedValue(null);

      const result = await toggleAutomationEnabled('tsk_1', 'aut_1', true);

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(mocks.serverApiPatch).not.toHaveBeenCalled();
    });

    it('proceeds for an authenticated session', async () => {
      mocks.serverApiPatch.mockResolvedValue({ data: {} });

      const result = await toggleAutomationEnabled('tsk_1', 'aut_1', true);

      expect(result).toEqual({ success: true });
      expect(mocks.serverApiPatch).toHaveBeenCalled();
    });
  });
});
