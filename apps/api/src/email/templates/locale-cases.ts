import type { EmailLocale } from '../locale';

export type LocaleCase = {
  name: string;
  enMarker: string;
  esMarker: string;
  build: (locale?: EmailLocale) => string;
};

/**
 * Renders each template with no locale (English default) and with `es`,
 * asserting the Spanish copy is present, the English marker is gone, and
 * the `<html lang>` attribute matches.
 */
export function runLocaleCases(cases: LocaleCase[]): void {
  for (const templateCase of cases) {
    it(`${templateCase.name} renders English by default`, () => {
      const html = templateCase.build();
      expect(html).toContain('lang="en"');
      expect(html).toContain(templateCase.enMarker);
    });

    it(`${templateCase.name} renders Spanish with locale es`, () => {
      const html = templateCase.build('es');
      expect(html).toContain('lang="es"');
      expect(html).toContain(templateCase.esMarker);
      expect(html).not.toContain(templateCase.enMarker);
    });
  }
}
