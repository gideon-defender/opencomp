import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '../test-utils/render-with-intl';
import { LanguageSwitcher } from './language-switcher';

const reloadMock = vi.fn();

Object.defineProperty(window, 'location', {
  value: { reload: reloadMock },
  writable: true,
});

describe('LanguageSwitcher', () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.cookie = 'NEXT_LOCALE=; path=/; max-age=0';
  });

  it('marks the active locale and labels the group in English', () => {
    renderWithIntl(<LanguageSwitcher />);
    expect(screen.getByRole('radiogroup', { name: 'Language' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'English' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Español' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('labels the group in Spanish under the es locale', () => {
    renderWithIntl(<LanguageSwitcher />, 'es');
    expect(screen.getByRole('radiogroup', { name: 'Idioma' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Español' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('persists the chosen locale to a cookie and reloads', () => {
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    expect(document.cookie).toContain('NEXT_LOCALE=es');
    expect(reloadMock).toHaveBeenCalledOnce();
  });

  it('does nothing when the active locale is re-selected', () => {
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole('radio', { name: 'English' }));
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
