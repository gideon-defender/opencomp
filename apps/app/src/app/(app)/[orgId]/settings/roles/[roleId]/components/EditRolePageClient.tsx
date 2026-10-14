'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@gideon-defender/ui/card';
import Link from 'next/link';
import type { CustomRole } from '../../components/RolesTable';

interface EditRolePageClientProps {
  orgId: string;
  initialData: CustomRole;
}

export function EditRolePageClient({ orgId, initialData }: EditRolePageClientProps) {
  // Gideon manages assignments; it does not import role permission definitions.
  return (
    <Card>
      <CardHeader>
        <CardTitle>Role Details</CardTitle>
        <CardDescription>
          OpenComp defines the permissions for {initialData.name}. Manage user assignments in
          Gideon. This page is read-only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link className="text-sm underline" href={`/${orgId}/settings/roles`}>
          Back to roles
        </Link>
      </CardContent>
    </Card>
  );
}
