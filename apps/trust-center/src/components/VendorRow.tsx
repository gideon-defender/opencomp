import { upgradeFaviconUrl, type PortalVendor } from '@/lib/api';
import { toSafeExternalHref } from '@/lib/urls';
import { ExternalLink } from 'lucide-react';

function VendorInitials({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  return (
    <div
      aria-hidden="true"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-canvas text-sm font-semibold text-muted"
    >
      {initials}
    </div>
  );
}

/**
 * Subprocessor row: vendor logo (with initials fallback), name, truncated
 * description, and outbound link. The whole row is the link, with a subtle
 * fill and border change on hover and no layout shift.
 */
export function VendorRow({ vendor }: { vendor: PortalVendor }) {
  // Stored websites are org-controlled data: bare domains gain https://,
  // non-http(s) schemes render as plain text (never a link).
  const url = toSafeExternalHref(vendor.trustPortalUrl || vendor.website);
  // Stored auto-generated favicons get upgraded to high-res assets for
  // known-bad domains (e.g. GitHub's 32px favicon).
  const logoUrl = upgradeFaviconUrl(vendor.logoUrl);

  const body = (
    <>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          className="h-11 w-11 shrink-0 rounded-md border border-line object-contain"
          loading="lazy"
        />
      ) : (
        <VendorInitials name={vendor.name} />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold">{vendor.name}</p>
        {vendor.description && <p className="truncate text-sm text-muted">{vendor.description}</p>}
      </div>
      <span
        aria-hidden="true"
        className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-md text-muted"
      >
        <ExternalLink size={16} aria-hidden="true" />
      </span>
    </>
  );

  if (!url) {
    return (
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 last:border-b-0">
        {body}
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${vendor.name} website`}
      className="flex items-center gap-2 border-b border-line px-4 py-3 transition-colors last:border-b-0 hover:border-muted hover:bg-canvas"
    >
      {body}
    </a>
  );
}
