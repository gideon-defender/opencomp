import { safeBrandImageUrl } from '@/lib/branding';

function initialsFor(name: string): string {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  return initials || '?';
}

/**
 * Org logo from /settings upload, with initials fallback. `logoUrl` is an
 * org-controlled S3 signed URL — only safe http(s) values render as <img>.
 */
export function OrgLogo({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl: string | null | undefined;
}) {
  const src = safeBrandImageUrl(logoUrl);
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`${name} logo`}
        className="h-16 w-16 shrink-0 rounded-lg border border-line object-contain"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-primary text-xl font-bold text-white"
    >
      {initialsFor(name)}
    </div>
  );
}
