import { afterEach, describe, expect, it, vi } from 'vitest';
import { displayHost, FRAMEWORK_TITLES, statusLabel, trustApi, upgradeFaviconUrl } from './api';

describe('displayHost', () => {
  it('prefers a verified custom domain', () => {
    expect(
      displayHost({
        domain: 'security.acme.com',
        domainVerified: true,
        friendlyUrl: 'acme',
      }),
    ).toBe('security.acme.com');
  });

  it('falls back to the shared host when unverified', () => {
    expect(
      displayHost({
        domain: 'security.acme.com',
        domainVerified: false,
        friendlyUrl: 'acme',
      }),
    ).toBe('trust.gideondefender.com/acme');
  });

  it('falls back to the shared host without a domain', () => {
    expect(displayHost({ domain: null, domainVerified: false, friendlyUrl: null })).toBe(
      'trust.gideondefender.com/',
    );
  });
});

describe('statusLabel', () => {
  it('labels all three lifecycle states', () => {
    expect(statusLabel('compliant')).toBe('Compliant');
    expect(statusLabel('in_progress')).toBe('In Progress');
    expect(statusLabel('started')).toBe('Started');
  });
});

describe('upgradeFaviconUrl', () => {
  it('upgrades known-bad Google favicon URLs to high-res assets', () => {
    expect(upgradeFaviconUrl('https://www.google.com/s2/favicons?domain=github.com&sz=128')).toBe(
      'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
    );
    expect(
      upgradeFaviconUrl('https://www.google.com/s2/favicons?domain=cloud.google.com&sz=128'),
    ).toBe('https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png');
  });

  it('leaves good favicons, manual uploads, and empty values alone', () => {
    const aws = 'https://www.google.com/s2/favicons?domain=aws.amazon.com&sz=128';
    expect(upgradeFaviconUrl(aws)).toBe(aws);
    expect(upgradeFaviconUrl('https://example.com/custom-logo.png')).toBe(
      'https://example.com/custom-logo.png',
    );
    expect(upgradeFaviconUrl(null)).toBeNull();
  });
});

describe('FRAMEWORK_TITLES', () => {
  it('covers every native framework the API can return', () => {
    for (const slug of [
      'soc2_type1',
      'soc2_type2',
      'soc3',
      'iso_27001',
      'iso_42001',
      'iso_9001',
      'gdpr',
      'hipaa',
      'pci_dss',
      'nen_7510',
      'pipeda',
      'ccpa',
      'dora',
      'nis_2',
      'hitrust_csf',
      'nist_csf',
      'nist_800_53',
    ]) {
      expect(FRAMEWORK_TITLES[slug], slug).toBeTruthy();
    }
  });
});

describe('trustApi network layer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(response: { status: number; ok: boolean; body?: unknown }) {
    const fetchMock = vi.fn().mockResolvedValue({
      status: response.status,
      ok: response.ok,
      json: () => Promise.resolve(response.body ?? null),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('degrades a 404 list to an empty array', async () => {
    stubFetch({ status: 404, ok: false });

    await expect(trustApi.frameworks('acme')).resolves.toEqual([]);
    await expect(trustApi.faqs('acme')).resolves.toEqual([]);
  });

  it('defaults the questionnaire to visible on a 404', async () => {
    stubFetch({ status: 404, ok: false });

    await expect(trustApi.questionnaireEnabled('acme')).resolves.toBe(true);
  });

  it('respects a disabled questionnaire flag', async () => {
    stubFetch({ status: 200, ok: true, body: { enabled: false } });

    await expect(trustApi.questionnaireEnabled('acme')).resolves.toBe(false);
  });

  it('throws on a 500 so pages can degrade explicitly', async () => {
    stubFetch({ status: 500, ok: false });

    await expect(trustApi.policies('acme')).rejects.toThrow('Trust API request failed');
  });

  it('rejects a failed access request post', async () => {
    stubFetch({ status: 400, ok: false });

    await expect(trustApi.requestAccess('acme', { name: 'A' })).rejects.toThrow(
      'Trust API request failed',
    );
  });

  it('encodes portal ids and tokens into fetch paths', async () => {
    const fetchMock = stubFetch({ status: 200, ok: true, body: {} });

    await trustApi.profile('acme security');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/trust-access/acme%20security/profile'),
      expect.anything(),
    );
  });
});
