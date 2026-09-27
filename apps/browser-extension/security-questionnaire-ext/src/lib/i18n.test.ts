import { describe, expect, it, vi, afterEach } from 'vitest';
import enMessages from '../../public/_locales/en/messages.json';
import esMessages from '../../public/_locales/es/messages.json';
import { t } from './i18n';

const enKeys = Object.keys(enMessages).sort();
const esKeys = Object.keys(esMessages).sort();

describe('locale parity', () => {
  it('has the same keys in en and es', () => {
    expect(esKeys).toEqual(enKeys);
  });

  it('has non-empty es translations for every key', () => {
    for (const [key, entry] of Object.entries(esMessages)) {
      expect(typeof (entry as { message?: unknown }).message, key).toBe('string');
      expect(((entry as { message: string }).message ?? '').trim().length, key).toBeGreaterThan(0);
    }
  });

  it('spot-checks Spanish translations', () => {
    expect((esMessages.sidepanelTitle as { message: string }).message).toBe('Cuestionario');
    expect((esMessages.commonCancel as { message: string }).message).toBe('Cancelar');
    expect((esMessages.footerApproveToInsert as { message: string }).message).toBe(
      'Aprueba respuestas para insertar',
    );
  });
});

describe('t() fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to bundled English without chrome.i18n', () => {
    vi.unstubAllGlobals();
    expect(t('commonCancel')).toBe('Cancel');
  });

  it('applies $1 substitutions in the fallback', () => {
    expect(t('footerCopyAnswers', '2')).toBe('Copy 2 answers');
    expect(t('sheetMapQuestionsAnswers', ['B', 'C'])).toBe('Questions B · Answers C');
  });

  it('uses chrome.i18n when available', () => {
    vi.stubGlobal('chrome', { i18n: { getMessage: (key: string) => `MSG:${key}` } });
    expect(t('commonCancel')).toBe('MSG:commonCancel');
  });

  it('falls back to English when chrome.i18n returns empty', () => {
    vi.stubGlobal('chrome', { i18n: { getMessage: () => '' } });
    expect(t('commonCancel')).toBe('Cancel');
  });
});
