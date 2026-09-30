/**
 * High-resolution logo overrides. Google's favicon service serves some
 * domains at tiny sizes no matter the `sz` param (github.com comes back
 * 32x32), which looks blurry once upscaled. These official assets replace
 * those cases. Keyed by registrable domain so subdomains match too.
 */
export const HIGH_RES_LOGO_OVERRIDES: Record<string, string> = {
  'github.com':
    'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
  'google.com':
    'https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png',
};

/**
 * Common two-label public suffixes (co.uk, com.au, …). The naive
 * "last two labels" rule returns `co.uk` for `example.co.uk`, which breaks
 * override matching. Suffix-aware logic keeps the label before the suffix.
 */
const TWO_LABEL_PUBLIC_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'me.uk',
  'ac.uk',
  'gov.uk',
  'co.jp',
  'or.jp',
  'ne.jp',
  'ac.jp',
  'go.jp',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'co.in',
  'co.kr',
  'com.br',
  'com.cn',
  'com.mx',
  'com.tr',
]);

export function registrableDomain(domain: string): string {
  const lower = domain.toLowerCase();
  const parts = lower.split('.');
  if (parts.length <= 2) return lower;
  const suffix = parts.slice(-2).join('.');
  if (TWO_LABEL_PUBLIC_SUFFIXES.has(suffix) && parts.length > 2) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

/**
 * True when `domain` equals `registered` or sits under it
 * (`sub.github.com` matches `github.com`, `notgithub.com` does not).
 */
function matchesDomainOrSubdomain(domain: string, registered: string): boolean {
  const lower = domain.toLowerCase();
  const base = registered.toLowerCase();
  return lower === base || lower.endsWith(`.${base}`);
}

/**
 * Upgrade an auto-generated Google favicon URL to a high-res asset when its
 * domain is a known-bad case. Applies to stored and computed URLs alike, so
 * vendors synced before the override existed get fixed at render time.
 * Manually uploaded logos (anything that is not a Google favicon URL) pass
 * through untouched.
 */
export function upgradeFaviconUrl(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  let domain: string | null = null;
  try {
    const parsed = new URL(logoUrl);
    if (
      parsed.hostname === 'www.google.com' &&
      parsed.pathname === '/s2/favicons'
    ) {
      domain = parsed.searchParams.get('domain');
    }
  } catch {
    // Unparsable input has no trusted domain to match — never hand it to an
    // <img src> sink. Callers render a placeholder instead.
    return null;
  }
  if (!domain) return logoUrl;
  const lower = domain.toLowerCase();
  if (Object.hasOwn(HIGH_RES_LOGO_OVERRIDES, lower)) {
    return HIGH_RES_LOGO_OVERRIDES[lower] as string;
  }
  for (const [registered, replacement] of Object.entries(
    HIGH_RES_LOGO_OVERRIDES,
  )) {
    if (matchesDomainOrSubdomain(lower, registered)) return replacement;
  }
  return logoUrl;
}
