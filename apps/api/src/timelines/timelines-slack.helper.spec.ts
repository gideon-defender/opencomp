import {
  notifyPhaseCompleted,
  notifyReadyForReview,
  notifyTimelineCompleted,
} from './timelines-slack.helper';

const mockFetch = jest.fn();

describe('timelines-slack.helper links', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SLACK_CX_WEBHOOK_URL = 'https://hooks.slack.test/cx';
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
  });

  afterEach(() => {
    delete process.env.SLACK_CX_WEBHOOK_URL;
    jest.restoreAllMocks();
  });

  it('links to the surviving org timeline page, not the removed admin page', async () => {
    await notifyReadyForReview({
      orgId: 'org_123',
      orgName: 'Acme',
      frameworkName: 'SOC 2',
      phaseName: 'Phase 1',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const text = JSON.stringify(body.blocks);
    expect(text).toContain('/org_123/overview/timeline');
    expect(text).not.toContain('/admin/');
  });

  it('uses the timeline link for phase and timeline completion notices', async () => {
    await notifyPhaseCompleted({
      orgId: 'org_123',
      orgName: 'Acme',
      frameworkName: 'SOC 2',
      phaseName: 'Phase 1',
      completionType: 'MANUAL',
    });
    await notifyTimelineCompleted({
      orgId: 'org_123',
      orgName: 'Acme',
      frameworkName: 'SOC 2',
    });

    for (const call of mockFetch.mock.calls) {
      const text = call[1].body as string;
      expect(text).toContain('/org_123/overview/timeline');
      expect(text).not.toContain('/admin/');
    }
  });

  it('escapes markup in org, phase, and framework names', async () => {
    await notifyReadyForReview({
      orgId: 'org_123',
      orgName: 'Acme <R&D>',
      frameworkName: 'SOC 2 & More',
      phaseName: 'Phase > 1',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const text = JSON.stringify(body.blocks);
    expect(text).toContain('Acme &lt;R&amp;D&gt;');
    expect(text).toContain('SOC 2 &amp; More');
    expect(text).toContain('Phase &gt; 1');
    expect(text).not.toContain('Acme <R&D>');
  });
});
