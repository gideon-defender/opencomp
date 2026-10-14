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

  // IdP-owned user management: ownership is a Gideon assignment (server
  // returns 410 on POST /v1/organization/transfer-ownership). Read-only.
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
          The local transfer action is disabled. The server denies it with 410 Gone.
        </p>
      </CardContent>
    </Card>
  );
}
