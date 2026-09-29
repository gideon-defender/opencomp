import { describe, expect, it } from 'vitest';
import { enMessages, esMessages, getMessagesForLocale } from './messages';
import { routing } from './routing';

type Messages = typeof enMessages;

function collectKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('i18n routing', () => {
  it('supports en and es with en as default and no URL prefix', () => {
    expect([...routing.locales]).toEqual(['en', 'es']);
    expect(routing.defaultLocale).toBe('en');
    expect(routing.localePrefix).toBe('never');
  });
});

describe('i18n message catalogs', () => {
  it('exposes all ten namespaces for the default locale', () => {
    expect(Object.keys(enMessages).sort()).toEqual(
      [
        'auth',
        'dialogs',
        'editableCell',
        'frameworks',
        'shell',
        'tasks',
        'toasts',
        'toolbar',
        'unsavedChanges',
        'validation',
      ].sort(),
    );
  });

  it('keeps identical key shapes between en and es', () => {
    const enKeys = collectKeys(enMessages).sort();
    const esKeys = collectKeys(esMessages as Messages).sort();
    expect(esKeys).toEqual(enKeys);
    expect(enKeys.length).toBeGreaterThan(100);
  });

  it('provides real Spanish (not English copies) for user-facing strings', () => {
    expect(esMessages.shell.signOut).toBe('Cerrar sesión');
    expect(esMessages.toolbar.searchPlaceholder).toBe('Buscar...');
    expect(esMessages.editableCell.openLargeEditor).toBe('Abrir editor grande');
    expect(esMessages.tasks.addTask).toBe('Añadir tarea');
    expect(esMessages.frameworks.searchPlaceholder).toBe('Buscar marcos...');
    expect(esMessages.toasts.frameworkCreated).not.toBe(enMessages.toasts.frameworkCreated);
    expect(esMessages.validation.nameRequired).not.toBe(enMessages.validation.nameRequired);
    expect(esMessages.unsavedChanges.confirmMessage).toContain('sin confirmar');
    expect(esMessages.auth.heroTitle).not.toBe(enMessages.auth.heroTitle);
  });

  it('falls back to English for unknown locales', () => {
    expect(getMessagesForLocale('en')).toBe(enMessages);
    expect(getMessagesForLocale('es')).toBe(esMessages);
    expect(getMessagesForLocale('fr')).toBe(enMessages);
  });
});
