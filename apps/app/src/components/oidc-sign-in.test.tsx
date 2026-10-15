import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OidcSignIn } from './oidc-sign-in';

vi.mock('@/env.mjs', () => ({
  env: { NEXT_PUBLIC_API_URL: 'https://api.example.com' },
}));

describe('OidcSignIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
    });
  });

  it('uses the login route supported by both old and new API tasks', () => {
    render(<OidcSignIn />);

    fireEvent.click(screen.getByRole('button'));

    expect(window.location.href).toBe('https://api.example.com/v1/auth/gideon/login');
  });

  it('forwards inviteCode and redirectTo as query params', () => {
    render(<OidcSignIn inviteCode="inv_abc123" redirectTo="/risks" />);

    fireEvent.click(screen.getByRole('button'));

    const url = new URL(window.location.href);
    expect(`${url.origin}${url.pathname}`).toBe('https://api.example.com/v1/auth/gideon/login');
    expect(url.searchParams.get('inviteCode')).toBe('inv_abc123');
    expect(url.searchParams.get('redirectTo')).toBe('/risks');
  });
});
