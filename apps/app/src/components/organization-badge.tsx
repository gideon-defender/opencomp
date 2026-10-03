'use client';

import { getInitials } from '@/lib/utils';
import { useState } from 'react';

interface OrganizationBadgeProps {
  organization: { id: string; name: string } | null;
  logoUrl?: string;
  isCollapsed?: boolean;
  maxWidth?: string;
}

export function OrganizationBadge({
  organization,
  logoUrl,
  isCollapsed = false,
  maxWidth = '150px',
}: OrganizationBadgeProps) {
  const [hasLogoError, setHasLogoError] = useState(false);

  // A new logo URL (e.g. fresh presigned URL after navigation) clears a
  // previous load failure so a valid logo is never hidden by stale state.
  // Synced during render (not in an effect): an effect that calls setState
  // unconditionally retriggers render and trips the cascading-render lint.
  const [lastLogoUrl, setLastLogoUrl] = useState(logoUrl);
  if (lastLogoUrl !== logoUrl) {
    setLastLogoUrl(logoUrl);
    setHasLogoError(false);
  }

  if (!organization) {
    return null;
  }

  const handleLogoError = () => {
    setHasLogoError(true);
  };

  const showLogo = Boolean(logoUrl) && !hasLogoError;

  const leading = showLogo ? (
    <img
      src={logoUrl}
      alt={`${organization.name} logo`}
      width={20}
      height={20}
      className="size-5 shrink-0 rounded-sm object-contain"
      loading="lazy"
      onError={handleLogoError}
    />
  ) : (
    <span
      aria-hidden
      className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium"
    >
      {getInitials(organization.name)}
    </span>
  );

  if (isCollapsed) {
    return (
      <div
        data-slot="organization-badge"
        title={organization.name}
        aria-label={organization.name}
        className="flex h-8 w-fit items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm whitespace-nowrap"
      >
        {leading}
      </div>
    );
  }

  return (
    <div
      data-slot="organization-badge"
      title={organization.name}
      aria-label={organization.name}
      className="flex h-8 w-fit items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm whitespace-nowrap"
    >
      {leading}
      <span className="truncate" style={{ maxWidth }}>
        {organization.name}
      </span>
    </div>
  );
}
