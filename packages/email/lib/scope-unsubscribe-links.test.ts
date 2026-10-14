import { afterEach, describe, expect, it, vi } from 'vitest';
import { scopeUnsubscribeLinks } from './scope-unsubscribe-links';
import {
  generateUserUnsubscribeToken,
  getUnsubscribeUrl,
  getUserUnsubscribeUrl,
} from './unsubscribe';

const recipient = {
  email: 'recipient@example.com',
  userId: 'usr_recipient',
  organizationId: 'org_recipient',
};

describe('unsubscribe footer scan', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('scopes multiple signed footer links and preserves surrounding HTML', () => {
    const link = getUnsubscribeUrl(recipient.email);
    const html = `<a href="${link.replaceAll('&', '&amp;')}">First</a>
<a href='${link}'>Second</a>`;
    const scoped = scopeUnsubscribeLinks({ ...recipient, html });
    expect(scoped).toContain('>First</a>');
    expect(scoped).toContain('>Second</a>');
    const links = [...scoped.matchAll(/href=["']([^"']+)["']/g)];
    expect(links).toHaveLength(2);
    for (const match of links) {
      const url = new URL((match[1] ?? '').replaceAll('&amp;', '&'));
      expect(url.searchParams.get('userId')).toBe(recipient.userId);
      expect(url.searchParams.get('organizationId')).toBe(recipient.organizationId);
      expect(url.searchParams.get('token')).toBe(generateUserUnsubscribeToken(recipient));
    }
  });

  it('does not sign external links, even with a copied valid footer token', () => {
    const url = new URL(getUnsubscribeUrl(recipient.email));
    url.host = 'attacker.example';
    const html = `<a href="${url}">Preferences</a>`;
    expect(scopeUnsubscribeLinks({ ...recipient, html })).toBe(html);
  });

  it('leaves URLs in comment text and other attributes unchanged', () => {
    const url = getUnsubscribeUrl(recipient.email);
    const html = `<p>${url} </p><a title="${url}" data-href="${url}" href="https://example.com">Comment</a>`;
    expect(scopeUnsubscribeLinks({ ...recipient, html })).toBe(html);
  });

  it('does not sign an unsigned link on the trusted origin', () => {
    const url = new URL(getUnsubscribeUrl(recipient.email));
    for (const token of [null, 'forged-token']) {
      if (token) url.searchParams.set('token', token);
      else url.searchParams.delete('token');
      const html = `<a href="${url}">Preferences</a>`;
      expect(scopeUnsubscribeLinks({ ...recipient, html })).toBe(html);
    }
  });

  it('scopes a signed user footer but retains other users and tenants', () => {
    const link = getUserUnsubscribeUrl(recipient);
    const oldLink = getUserUnsubscribeUrl({ email: recipient.email, userId: recipient.userId });
    expect(scopeUnsubscribeLinks({ ...recipient, html: `<a href="${oldLink}">Own</a>` })).toBe(
      `<a href="${link.replaceAll('&', '&amp;')}">Own</a>`,
    );
    for (const overrides of [{ userId: 'other-user' }, { organizationId: 'other-org' }]) {
      const otherLink = getUserUnsubscribeUrl({ ...recipient, ...overrides });
      const html = `<a href="${otherLink}">Other</a>`;
      expect(scopeUnsubscribeLinks({ ...recipient, html })).toBe(html);
    }
  });

  it('uses the configured origin and rejects a different protocol or port', () => {
    vi.stubEnv('NEXT_PUBLIC_BETTER_AUTH_URL', 'http://localhost:3000');
    const link = getUnsubscribeUrl(recipient.email);
    const html = `<a href="${link}">Local</a>`;
    expect(scopeUnsubscribeLinks({ ...recipient, html })).toContain('organizationId=org_recipient');
    for (const origin of ['https://localhost:3000', 'http://localhost:3001']) {
      const url = new URL(link);
      const replacement = new URL(origin);
      url.protocol = replacement.protocol;
      url.host = replacement.host;
      const otherHtml = `<a href="${url}">Other</a>`;
      expect(scopeUnsubscribeLinks({ ...recipient, html: otherHtml })).toBe(otherHtml);
    }
  });

  it('leaves a large token of repeated URL prefixes unchanged', () => {
    const html = `<a href="${'http://'.repeat(100_000)}">Unrelated</a>`;
    expect(scopeUnsubscribeLinks({ ...recipient, html })).toBe(html);
  }, 1000);

  it('handles repeated tabs and incomplete anchor tags without backtracking', () => {
    const startedAt = performance.now();
    for (const html of [
      `<a ${'\t'.repeat(100_000)}missing-value>Comment</a>`,
      `<a href ${'\t'.repeat(100_000)}=missing-quotes>Comment</a>`,
      '<a '.repeat(100_000),
    ]) {
      expect(scopeUnsubscribeLinks({ ...recipient, html })).toBe(html);
    }
    expect(performance.now() - startedAt).toBeLessThan(1000);
  }, 1500);

  it('preserves quoted attributes, comments, and tag names that contain an anchor', () => {
    const link = getUnsubscribeUrl(recipient.email);
    const unrelated = `<div title="<a href='${link}'>">Text</div><!-- <a href="${link}"> -->`;
    const html = `${unrelated}<article href="${link}">Text</article><A title="1 > 0" HREF = '${link}'>Preferences</A>`;
    const scoped = scopeUnsubscribeLinks({ ...recipient, html });
    expect(scoped).toContain(`${unrelated}<article href="${link}">Text</article>`);
    expect(scoped).toContain(
      `<A title="1 > 0" HREF = '${getUserUnsubscribeUrl(recipient).replaceAll('&', '&amp;')}'>Preferences</A>`,
    );
  });

  it('preserves malformed URLs instead of failing the email enqueue', () => {
    const html = `<a href="http://[/unsubscribe/preferences?email=recipient%40example.com">Bad</a>`;
    expect(scopeUnsubscribeLinks({ ...recipient, html })).toBe(html);
  });

  it('does not scope an unsubscribe path embedded in an unrelated URL query', () => {
    const html =
      '<a href="https://example.com/other?next=/unsubscribe/preferences?email=recipient%40example.com">Other</a>';
    expect(scopeUnsubscribeLinks({ ...recipient, html })).toBe(html);
  });

  it('retains links for other recipients and emails without tenant scope', () => {
    const html = `<a href="${getUnsubscribeUrl('other@example.com')}">Other</a>`;
    expect(scopeUnsubscribeLinks({ ...recipient, html })).toBe(html);
    const ownHtml = `<a href="${getUnsubscribeUrl(recipient.email)}">Own</a>`;
    expect(scopeUnsubscribeLinks({ email: recipient.email, html: ownHtml })).toBe(ownHtml);
  });
});
