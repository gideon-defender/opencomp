import { describe, expect, it, vi } from 'vitest';
import { getUnsubscribedEmails, isUserUnsubscribed } from './check-unsubscribe';
import { resolveUnsubscribeUser } from './resolve-unsubscribe-user';
import { scopeUnsubscribeLinks } from './scope-unsubscribe-links';
import { generateUserUnsubscribeToken, getUserUnsubscribeUrl } from './unsubscribe';

const email = 'shared@example.com';
const original = { id: 'shared', email, emailNotificationsUnsubscribed: true };
const clone = { id: 'clone', email, emailNotificationsUnsubscribed: false };

describe('unsubscribe links across the tenant split', () => {
  it.each([{ ...original, email: 'renamed@example.com' }, null])(
    'resolves the secondary clone after the original account changes: %j',
    async (primary) => {
      const db = {
        user: {
          findUnique: vi.fn().mockResolvedValue(primary),
          findMany: vi.fn().mockResolvedValue([clone]),
        },
      };
      const params = { userId: original.id, email, organizationId: 'secondary' };
      expect(
        await resolveUnsubscribeUser({
          db,
          ...params,
          token: generateUserUnsubscribeToken(params),
        }),
      ).toEqual(clone);
    },
  );

  it('still rejects an unscoped link after the original email changes', async () => {
    const db = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ ...original, email: 'renamed@example.com' }),
        findMany: vi.fn().mockResolvedValue([clone]),
      },
    };
    const params = { userId: original.id, email };
    expect(
      await resolveUnsubscribeUser({ db, ...params, token: generateUserUnsubscribeToken(params) }),
    ).toBeNull();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it('binds the rendered footer to the originating tenant and resolves its clone after split', async () => {
    const link = getUserUnsubscribeUrl({ userId: original.id, email });
    const html = scopeUnsubscribeLinks({
      html: `<a href="${link.replaceAll('&', '&amp;')}">Preferences</a>`,
      email,
      userId: original.id,
      organizationId: 'secondary',
    });
    const match = html.match(/href="([^"]+)"/);
    if (!match?.[1]) throw new Error('No footer link');
    const params = new URL(match[1].replaceAll('&amp;', '&')).searchParams;
    expect(params.get('organizationId')).toBe('secondary');
    const db = {
      user: {
        findUnique: vi.fn().mockResolvedValue(original),
        findMany: vi.fn().mockResolvedValue([clone]),
      },
    };
    const user = await resolveUnsubscribeUser({
      db,
      userId: original.id,
      email,
      organizationId: 'secondary',
      token: params.get('token') ?? '',
    });
    expect(user?.id).toBe('clone');
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { tenantId: 'secondary' },
            { members: { some: { organizationId: 'secondary', deactivated: false } } },
          ],
        }),
      }),
    );
  });

  it('rejects a changed tenant before reading or changing any account', async () => {
    const db = { user: { findUnique: vi.fn(), findMany: vi.fn() } };
    const token = generateUserUnsubscribeToken({
      userId: original.id,
      email,
      organizationId: 'secondary',
    });
    expect(
      await resolveUnsubscribeUser({
        db,
        userId: original.id,
        email,
        organizationId: 'primary',
        token,
      }),
    ).toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it('resolves an unsplit secondary membership without guessing between accounts', async () => {
    const db = {
      user: {
        findUnique: vi.fn().mockResolvedValue(original),
        findMany: vi.fn().mockResolvedValue([original]),
      },
    };
    const token = generateUserUnsubscribeToken({
      userId: original.id,
      email,
      organizationId: 'secondary',
    });
    expect(
      await resolveUnsubscribeUser({
        db,
        userId: original.id,
        email,
        organizationId: 'secondary',
        token,
      }),
    ).toEqual(original);
    db.user.findMany.mockResolvedValue([original, clone]);
    expect(
      await resolveUnsubscribeUser({
        db,
        userId: original.id,
        email,
        organizationId: 'secondary',
        token,
      }),
    ).toBeNull();
  });

  it('does not replace unrelated links or a different recipient’s footer', () => {
    const html = `<a href="${getUserUnsubscribeUrl({ userId: 'other', email: 'other@example.com' })}">Other</a>`;
    expect(
      scopeUnsubscribeLinks({ html, email, userId: original.id, organizationId: 'secondary' }),
    ).toBe(html);
  });
});

describe('shared members retain their opt-outs during rollout', () => {
  it('uses only the requested membership when tenant ownership has not split', async () => {
    const db = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([original]),
      },
      member: { findMany: vi.fn().mockResolvedValue([]) },
      roleNotificationSetting: { findMany: vi.fn().mockResolvedValue([]) },
    };
    expect(await isUserUnsubscribed(db, email, 'taskReminders', 'secondary')).toBe(true);
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          email: { equals: email, mode: 'insensitive' },
          members: { some: { organizationId: 'secondary', deactivated: false } },
        },
      }),
    );
    expect(await getUnsubscribedEmails(db, [email], 'taskReminders', 'secondary')).toEqual(
      new Set([email]),
    );
  });

  it('does not suppress email for an unrelated tenant with the same address', async () => {
    const db = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    expect(await isUserUnsubscribed(db, email, 'taskReminders', 'unrelated')).toBe(false);
  });
});
