import { describe, expect, it } from 'vitest';
import enMessages from '../../messages/en.json';
import esMessages from '../../messages/es.json';

type Messages = Record<string, unknown>;

function collectLeaves(messages: Messages, prefix: string): Map<string, string> {
  const leaves = new Map<string, string>();
  const walk = (node: unknown, path: string) => {
    if (typeof node === 'string') {
      leaves.set(path, node);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Messages)) {
        walk(value, path ? `${path}.${key}` : key);
      }
    }
  };
  walk(messages, prefix);
  return leaves;
}

function interpolationParams(value: string): string[] {
  return [...value.matchAll(/\{(\w+)[,}]/g)].map((match) => match[1] ?? '').sort();
}

const REQUIRED_NAMESPACES = [
  'header',
  'overview',
  'access',
  'dashboard',
  'tasks',
  'deviceAgent',
  'fleet',
  'training',
  'policies',
  'policyPage',
  'forms',
  'submissions',
  'auth',
  'validation',
  'toasts',
  'modals',
  'errors',
  'nav',
] as const;

describe('portal i18n messages', () => {
  it('loads both en and es locales', () => {
    expect(Object.keys(enMessages).length).toBeGreaterThan(0);
    expect(Object.keys(esMessages).length).toBeGreaterThan(0);
  });

  it('covers all required namespaces in both locales', () => {
    for (const namespace of REQUIRED_NAMESPACES) {
      expect(enMessages, `en missing ${namespace}`).toHaveProperty(namespace);
      expect(esMessages, `es missing ${namespace}`).toHaveProperty(namespace);
    }
  });

  it('has identical key sets in en and es', () => {
    const enLeaves = collectLeaves(enMessages as Messages, '');
    const esLeaves = collectLeaves(esMessages as Messages, '');
    const enKeys = [...enLeaves.keys()].sort();
    const esKeys = [...esLeaves.keys()].sort();
    expect(esKeys).toEqual(enKeys);
  });

  it('has no empty strings in either locale', () => {
    for (const [locale, messages] of [
      ['en', enMessages],
      ['es', esMessages],
    ] as const) {
      for (const [key, value] of collectLeaves(messages as Messages, '')) {
        expect(value.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('uses matching interpolation params in en and es', () => {
    const enLeaves = collectLeaves(enMessages as Messages, '');
    const esLeaves = collectLeaves(esMessages as Messages, '');
    for (const [key, enValue] of enLeaves) {
      const esValue = esLeaves.get(key) ?? '';
      expect(interpolationParams(esValue), key).toEqual(interpolationParams(enValue));
    }
  });

  it('ships real Spanish translations for key strings', () => {
    const enLeaves = collectLeaves(enMessages as Messages, '');
    const esLeaves = collectLeaves(esMessages as Messages, '');
    const spotCheckKeys = [
      'header.title',
      'access.deniedTitle',
      'dashboard.companyForms',
      'tasks.securityPolicies',
      'policies.signedPolicies',
      'auth.continueWithGideon',
      'errors.notFoundTitle',
      'toasts.imagesRemoved',
      'validation.emailInvalid',
      'submissions.pending',
    ];
    for (const key of spotCheckKeys) {
      expect(esLeaves.has(key), `es missing ${key}`).toBe(true);
      expect(esLeaves.get(key), `es untranslated ${key}`).not.toBe(enLeaves.get(key));
    }
  });
});
