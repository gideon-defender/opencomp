import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OidcSignIn } from './oidc-sign-in';

vi.mock('next-intl', () => ({
  useTranslations: () => () => 'Continue with Gideon',
}));

describe('OidcSignIn rollout compatibility', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.com');
    Object.defineProperty(window, 'location', {
      value: { href: '', origin: 'https://portal.example.com' },
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('uses the generic OIDC login route', () => {
    render(<OidcSignIn />);

    fireEvent.click(screen.getByRole('button'));

    expect(window.location.href).toBe('https://api.example.com/v1/auth/oidc/login');
  });

  it('preserves the invitation and absolute portal return URL', () => {
    render(<OidcSignIn inviteCode="inv_abc123" redirectTo="/dashboard" />);

    fireEvent.click(screen.getByRole('button'));

    const url = new URL(window.location.href);
    expect(url.pathname).toBe('/v1/auth/oidc/login');
    expect(url.searchParams.get('inviteCode')).toBe('inv_abc123');
    expect(url.searchParams.get('redirectTo')).toBe('https://portal.example.com/dashboard');
  });
});
