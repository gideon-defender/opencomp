'use client';

import { useState } from 'react';
import { BrandSettings } from './BrandSettings';
import { UpdateTrustFavicon } from './UpdateTrustFavicon';

interface TrustPortalBrandingSettingsProps {
  enabled: boolean;
  primaryColor: string | null;
  faviconUrl: string | null;
}

export function TrustPortalBrandingSettings({
  enabled,
  primaryColor,
  faviconUrl,
}: TrustPortalBrandingSettingsProps) {
  const [currentPrimaryColor, setCurrentPrimaryColor] = useState(primaryColor);
  const [currentFaviconUrl, setCurrentFaviconUrl] = useState(faviconUrl);

  const [prevPrimaryColor, setPrevPrimaryColor] = useState(primaryColor);
  if (prevPrimaryColor !== primaryColor) {
    setPrevPrimaryColor(primaryColor);
    setCurrentPrimaryColor(primaryColor);
  }

  const [prevFaviconUrl, setPrevFaviconUrl] = useState(faviconUrl);
  if (prevFaviconUrl !== faviconUrl) {
    setPrevFaviconUrl(faviconUrl);
    setCurrentFaviconUrl(faviconUrl);
  }

  return (
    <div className="space-y-6">
      <UpdateTrustFavicon
        currentFaviconUrl={currentFaviconUrl}
        onFaviconChange={setCurrentFaviconUrl}
      />
      <BrandSettings
        enabled={enabled}
        primaryColor={currentPrimaryColor}
        onPrimaryColorChange={setCurrentPrimaryColor}
      />
    </div>
  );
}
