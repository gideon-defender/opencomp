import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import es from '../../../messages/es.json';

describe('OAuth availability guidance', () => {
  it.each([
    { locale: 'en', messages: en },
    { locale: 'es', messages: es },
  ])(
    '$locale describes unavailable credentials without the retired admin route',
    ({ messages }) => {
      const copy = messages.integrations.onboarding.oauthNotConfiguredDescription;
      expect(copy).toContain('{name}');
      expect(copy).toMatch(/credentials|credenciales/);
      // The responsible person's title can change without breaking the guidance.
      expect(copy).toContain('OpenComp');
      expect(copy).not.toContain('→');
      expect(copy).not.toMatch(/Admin → Integrations|Administración → Integraciones/);
    },
  );
});
