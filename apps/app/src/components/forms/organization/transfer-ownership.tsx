'use client';

import { usePermissions } from '@/hooks/use-permissions';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@gideon-defender/ui/card';

interface TransferOwnershipProps {
  isOwner: boolean;
}

export function TransferOwnership({ isOwner }: TransferOwnershipProps) {
  const { hasPermission } = usePermissions();

  // Don't show this section if user is not the owner or lacks permission
  if (!isOwner || !hasPermission('organization', 'delete')) {
    return null;
  }

  // IdP-owned user management: ownership is a Gideon assignment. There is
  // no local transfer endpoint. Read-only.
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle>Transfer ownership</CardTitle>
        <CardDescription>
          <div className="max-w-[600px]">
            Ownership is assigned in Gideon. This section is read-only — assign the owner role in
            Gideon to transfer ownership.
          </div>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          There is no local transfer action. Assign the owner role in Gideon.
        </p>
      </CardContent>
    </Card>
  );
}
