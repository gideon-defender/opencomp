import { isSafeHttpUrl } from '@/lib/urls';
import type { CSSProperties } from 'react';

export const DEFAULT_PRIMARY_COLOR = '#d92231';

function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(trimmed);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return `#${hex.toLowerCase()}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHexColor(hex) ?? DEFAULT_PRIMARY_COLOR;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

function soften(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

/**
 * Resolve the effective brand color, falling back to the default red when
 * the org has not set a valid hex color in trust branding settings.
 */
export function resolvePrimaryColor(primaryColor: string | null | undefined): string {
  return normalizeHexColor(primaryColor) ?? DEFAULT_PRIMARY_COLOR;
}

/**
 * CSS variable overrides for the trust portal theme. Tailwind v4 resolves
 * `bg-primary` etc. from `--color-primary`, so setting these inline on the
 * page root applies the org's brand color with a computed hover + soft tint.
 */
export function brandStyleFor(primaryColor: string | null | undefined): CSSProperties {
  const primary = resolvePrimaryColor(primaryColor);
  return {
    '--color-primary': primary,
    '--color-primary-hover': darken(primary, 0.15),
    '--color-primary-soft': soften(primary, 0.9),
  } as CSSProperties;
}

/**
 * Only render org-controlled image URLs that are safe http(s). S3 signed
 * URLs, uploads, and plain https logos pass; javascript:/data: never render.
 */
export function safeBrandImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return isSafeHttpUrl(url) ? url : null;
}
