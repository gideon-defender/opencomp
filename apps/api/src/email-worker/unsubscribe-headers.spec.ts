import {
  verifyUnsubscribeToken,
  verifyUserUnsubscribeToken,
} from '@gideon-defender/email';
import { buildUnsubscribeHeaders } from './unsubscribe-headers';

const API_BASE = 'https://api.gideondefender.com';

function oneClickUrl(headers: Record<string, string>): string {
  const list = headers['List-Unsubscribe'];
  expect(list).toMatch(/^<.*>$/);
  return list.slice(1, -1);
}

describe('buildUnsubscribeHeaders', () => {
  it('mints a user-scoped one-click URL that verifies for exactly that account', () => {
    const headers = buildUnsubscribeHeaders({
      to: 'Person@Example.com',
      userId: 'usr_a',
      apiBaseUrl: API_BASE,
    });

    const url = new URL(oneClickUrl(headers));
    expect(url.searchParams.get('userId')).toBe('usr_a');
    expect(
      verifyUserUnsubscribeToken({
        userId: url.searchParams.get('userId') ?? '',
        email: url.searchParams.get('email') ?? '',
        token: url.searchParams.get('token') ?? '',
      }),
    ).toBe(true);
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('rejects the user-scoped token for another tenant’s same-email account', () => {
    const headers = buildUnsubscribeHeaders({
      to: 'person@example.com',
      userId: 'usr_a',
      apiBaseUrl: API_BASE,
    });

    const url = new URL(oneClickUrl(headers));
    expect(
      verifyUserUnsubscribeToken({
        userId: 'usr_b',
        email: url.searchParams.get('email') ?? '',
        token: url.searchParams.get('token') ?? '',
      }),
    ).toBe(false);
  });

  it('falls back to a legacy email-only URL when no user id is known', () => {
    const headers = buildUnsubscribeHeaders({
      to: 'person@example.com',
      apiBaseUrl: API_BASE,
    });

    const url = new URL(oneClickUrl(headers));
    expect(url.searchParams.get('userId')).toBeNull();
    expect(
      verifyUnsubscribeToken(
        url.searchParams.get('email') ?? '',
        url.searchParams.get('token') ?? '',
      ),
    ).toBe(true);
  });
});

it('binds the one-click header to the originating tenant', () => {
  const organizationId = 'secondary';
  const userId = 'shared';
  const email = 'shared@example.com';
  const params = new URL(
    oneClickUrl(
      buildUnsubscribeHeaders({
        to: email,
        userId,
        organizationId,
        apiBaseUrl: API_BASE,
      }),
    ),
  ).searchParams;
  const token = params.get('token') ?? '';
  expect(params.get('organizationId')).toBe(organizationId);
  expect(
    verifyUserUnsubscribeToken({ userId, organizationId, email, token }),
  ).toBe(true);
  expect(
    verifyUserUnsubscribeToken({
      userId,
      organizationId: 'primary',
      email,
      token,
    }),
  ).toBe(false);
});
