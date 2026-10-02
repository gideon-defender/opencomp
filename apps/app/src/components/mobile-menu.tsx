'use client';

import { BrandLogo } from '@gideon-defender/ui/brand-logo';
import { Button } from '@gideon-defender/ui/button';
import { Icons } from '@gideon-defender/ui/icons';
import { Sheet, SheetContent } from '@gideon-defender/ui/sheet';
import { useState } from 'react';
import { MainMenu } from './main-menu';
import { OrganizationBadge } from './organization-badge';

interface MobileMenuProps {
  organization: { id: string; name: string } | null;
  isCollapsed?: boolean;
  organizationId?: string;
  isQuestionnaireEnabled?: boolean;
  isTrustNdaEnabled?: boolean;
}

export function MobileMenu({
  organizationId,
  organization,
  isQuestionnaireEnabled = false,
  isTrustNdaEnabled = false,
}: MobileMenuProps) {
  const [isOpen, setOpen] = useState(false);

  const handleCloseSheet = () => {
    setOpen(false);
  };

  return (
    <Sheet open={isOpen} onOpenChange={setOpen}>
      <div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setOpen(true)}
          className="relative flex h-8 w-8 items-center rounded-full md:hidden"
        >
          <Icons.Menu size={16} />
        </Button>
      </div>
      <SheetContent side="left" className="-ml-2 rounded-sm border-none">
        <div className="mb-8 ml-2">
          <BrandLogo />
        </div>
        <div className="flex flex-col gap-2">
          <OrganizationBadge organization={organization} />
          <MainMenu
            organizationId={organizationId}
            onItemClick={handleCloseSheet}
            isQuestionnaireEnabled={isQuestionnaireEnabled}
            isTrustNdaEnabled={isTrustNdaEnabled}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
