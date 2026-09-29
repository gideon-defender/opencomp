import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageSwitcher } from './language-switcher';

const { mockedUseLocale } = vi.hoisted(() => ({ mockedUseLocale: vi.fn(() => 'en') }));

vi.mock('next-intl', () => ({
  useLocale: mockedUseLocale,
}));

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.cookie = '';
  });

  afterEach(() => {
    cleanup();
  });

  it('renders EN/ES options with English label when locale is en', () => {
    mockedUseLocale.mockReturnValue('en');
    render(<LanguageSwitcher />);
    expect(screen.getByRole('radiogroup', { name: 'Language' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'English' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Español' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'English' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('renders Spanish label when locale is es', () => {
    mockedUseLocale.mockReturnValue('es');
    render(<LanguageSwitcher />);
    expect(screen.getByRole('radiogroup', { name: 'Idioma' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Español' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('sets the NEXT_LOCALE cookie on change', async () => {
    mockedUseLocale.mockReturnValue('en');
    const user = userEvent.setup();
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadSpy },
      writable: true,
      configurable: true,
    });
    render(<LanguageSwitcher />);
    await user.click(screen.getByRole('radio', { name: 'Español' }));
    expect(document.cookie).toContain('NEXT_LOCALE=es');
    expect(reloadSpy).toHaveBeenCalled();
  });
});
