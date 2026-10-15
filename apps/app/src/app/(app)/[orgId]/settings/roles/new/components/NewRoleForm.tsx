'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@gideon-defender/ui/card';
import Link from 'next/link';

interface NewRoleFormProps {
  orgId: string;
}

export function NewRoleForm({ orgId }: NewRoleFormProps) {
  // IdP-owned user management: role content ships as code and assignments
  // live in Gideon. There is no local role-write endpoint. Read-only.
  return (
    <Card>
      <CardHeader>
        <CardTitle>Role Details</CardTitle>
        <CardDescription>
          OpenComp defines role permissions. Assign supported OpenComp roles in Gideon. A new role
          name in Gideon alone does not create an OpenComp role.
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
