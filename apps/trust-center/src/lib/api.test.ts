import { ndaFixture } from '@/test/nda-fixture';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  displayHost,
  FRAMEWORK_TITLES,
  serverMessage,
  statusLabel,
  trustApi,
  upgradeFaviconUrl,
} from './api';

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

describe('serverMessage', () => {
  it('returns plain string messages', () => {
    expect(serverMessage({ message: 'Signer email must match' })).toBe('Signer email must match');
  });

  it('returns the first string of array messages', () => {
    expect(serverMessage({ message: ['First problem', 'Second problem'] })).toBe('First problem');
  });

  it('returns null for missing, empty, or non-string messages', () => {
    expect(serverMessage({})).toBeNull();
    expect(serverMessage(null)).toBeNull();
    expect(serverMessage({ message: '' })).toBeNull();
    expect(serverMessage({ message: 42 })).toBeNull();
    expect(serverMessage({ message: [42] })).toBeNull();
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
    vi.unstubAllEnvs();
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

  it('fetches NDA details by token and degrades a 404 to null', async () => {
    const fetchMock = stubFetch({
      status: 200,
      ok: true,
      body: ndaFixture(),
    });

    vi.stubEnv('TRUST_API_URL', 'http://private-api:3333');
    vi.stubEnv('NEXT_PUBLIC_TRUST_API_URL', 'https://public-api.example.com');
    await expect(trustApi.nda('sign token')).resolves.toEqual(ndaFixture());

    expect(fetchMock).toHaveBeenCalledWith(
      'https://public-api.example.com/v1/trust-access/nda/sign%20token',
      { cache: 'no-store', credentials: 'include' },
    );

    stubFetch({ status: 404, ok: false });

    await expect(trustApi.nda('dead-token')).resolves.toBeNull();
  });

  it('rejects malformed NDA detail responses', async () => {
    stubFetch({ status: 200, ok: true, body: { id: 'nda_1' } });
    await expect(trustApi.nda('tok')).rejects.toThrow();
  });

  it('throws a retryable error instead of null on NDA read failures', async () => {
    stubFetch({ status: 500, ok: false });

    await expect(trustApi.nda('tok')).rejects.toThrow('Trust API request failed');
  });

  it('posts NDA signatures with the signer payload and returns the portal URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_TRUST_API_URL', 'https://api.example.com');
    const fetchMock = stubFetch({
      status: 200,
      ok: true,
      body: { message: 'NDA signed successfully', portalUrl: 'https://trust/x/access/tok' },
    });

    await expect(
      trustApi.signNda('tok 1', { name: 'Ada', email: 'a@x.com', accept: true }),
    ).resolves.toEqual({
      message: 'NDA signed successfully',
      portalUrl: 'https://trust/x/access/tok',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/trust-access/nda/tok%201/sign',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Ada', email: 'a@x.com', accept: true }),
      }),
    );
  });

  it('surfaces the server message when signing is rejected', async () => {
    stubFetch({
      status: 400,
      ok: false,
      body: { message: 'Signer email must match the access request email' },
    });

    await expect(
      trustApi.signNda('tok', { name: 'Ada', email: 'b@x.com', accept: true }),
    ).rejects.toThrow('Signer email must match the access request email');

    stubFetch({ status: 400, ok: false, body: { message: ['First problem'] } });

    await expect(
      trustApi.signNda('tok', { name: 'Ada', email: 'b@x.com', accept: true }),
    ).rejects.toThrow('First problem');
  });

  it('rejects an empty sign response instead of resolving null', async () => {
    stubFetch({ status: 200, ok: true });

    await expect(
      trustApi.signNda('tok', { name: 'Ada', email: 'a@x.com', accept: true }),
    ).rejects.toThrow('Trust API request failed');
  });

  it('rejects network failures with a generic error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(
      trustApi.signNda('tok', { name: 'Ada', email: 'a@x.com', accept: true }),
    ).rejects.toThrow('Trust API request failed');
    await expect(trustApi.previewNda('tok')).rejects.toThrow('Trust API request failed');
  });

  it('fetches NDA preview bytes from the public API instead of a signed S3 URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_TRUST_API_URL', 'https://api.example.com');
    const pdf = new Blob(['%PDF-preview'], { type: 'application/pdf' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => pdf });
    vi.stubGlobal('fetch', fetchMock);

    await expect(trustApi.previewNda('tok 1')).resolves.toBe(pdf);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/trust-access/nda/tok%201/preview-nda',
      { cache: 'no-store', credentials: 'include', headers: { Accept: 'application/pdf' } },
    );
  });

  it('surfaces the server message when preview is rejected', async () => {
    stubFetch({ status: 400, ok: false, body: { message: 'NDA has already been signed' } });

    await expect(trustApi.previewNda('tok')).rejects.toThrow('NDA has already been signed');
  });
});
