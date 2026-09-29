import { randomBytes } from 'crypto';

/**
 * Pure helpers for the trust-access grant/NDA flows. Extracted from
 * TrustAccessService so they evolve and test independently of DB and S3.
 * Every function here is side-effect free (no DB, no network, no clock).
 */

export interface PdfRgb {
  r: number;
  g: number;
  b: number;
}

/** Convert hex color to RGB values (0-1 range for pdf-lib). */
export function hexToPdfRgb(hex: string): PdfRgb {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;
  return { r, g, b };
}

const DEFAULT_ACCENT_COLOR: PdfRgb = { r: 0, g: 0.302, b: 0.239 };

/** Accent color from organization branding, with safe default fallback. */
export function getAccentColor(
  primaryColor: string | null | undefined,
): PdfRgb {
  // Default project primary color: dark teal/green (hsl(165, 100%, 15%))
  if (!primaryColor) return DEFAULT_ACCENT_COLOR;
  const color = hexToPdfRgb(primaryColor);
  if (Number.isNaN(color.r) || Number.isNaN(color.g) || Number.isNaN(color.b)) {
    console.warn('Invalid primary color format, using default:', primaryColor);
    return DEFAULT_ACCENT_COLOR;
  }
  return color;
}

/** Opaque URL-safe token with roughly 6 bits of entropy per character. */
export function generateTrustToken(length: number): string {
  return randomBytes(length).toString('base64url').slice(0, length);
}

/** Remove a single trailing slash so base URLs join cleanly. */
export function normalizePortalUrl(input: string): string {
  return input.endsWith('/') ? input.slice(0, -1) : input;
}

/** Strip protocol and path, lowercase — for custom-domain comparison. */
export function normalizePortalDomain(input: string): string {
  const trimmed = input.trim();
  const withoutProtocol = trimmed.replace(/^https?:\/\//i, '');
  const withoutPath = withoutProtocol.split('/')[0] ?? withoutProtocol;
  return withoutPath.trim().toLowerCase();
}

/** Extract the domain part of an email address, lowercased. Uses the last
 * `@` so a crafted `allowed.com@evil.com` local part cannot spoof the
 * allow-list check. */
export function extractEmailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return (at === -1 ? '' : email.slice(at + 1)).toLowerCase().trim();
}

/** True when the email's domain matches an allow-listed domain. */
export function isDomainInAllowList(
  email: string,
  allowedDomains: string[],
): boolean {
  if (!allowedDomains || allowedDomains.length === 0) return false;
  const emailDomain = extractEmailDomain(email);
  if (!emailDomain) return false;
  return allowedDomains.some(
    (allowed) => allowed.toLowerCase().trim() === emailDomain,
  );
}

/** True when the email itself matches an allow-listed address. */
export function isEmailInAllowList(
  email: string,
  allowedEmails: string[],
): boolean {
  if (!allowedEmails || allowedEmails.length === 0) return false;
  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail) return false;
  return allowedEmails.some(
    (allowed) => allowed.toLowerCase().trim() === normalizedEmail,
  );
}

/**
 * Convert a display name to a safe filename slug.
 * "Security Updates" -> "security_updates". Output is [a-z0-9_],
 * safe for Content-Disposition headers.
 */
export function toSafeFilename(name: string): string {
  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return safeName || 'policy';
}

const MAX_FILENAME_EXTENSION_LENGTH = 10;

/**
 * Convert a display name to a safe filename slug while preserving the file
 * extension. "Q4 Report.pdf" -> "q4_report.pdf". The base is slugified with
 * toSafeFilename; the extension is lowercased alphanumeric only so the
 * result stays safe for Content-Disposition headers.
 */
export function toSafeFilenameWithExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) {
    return toSafeFilename(name);
  }
  const base = toSafeFilename(name.slice(0, dot));
  const ext = name
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, MAX_FILENAME_EXTENSION_LENGTH);
  if (!ext) {
    return base;
  }
  return `${base}.${ext}`;
}
