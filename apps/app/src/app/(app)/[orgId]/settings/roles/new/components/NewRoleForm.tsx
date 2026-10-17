'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@gideon-defender/ui/card';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RoleForm, type RoleFormValues } from '../../components/RoleForm';
import { useRoleMutations } from '../../hooks/useRoles';

interface NewRoleFormProps {
  orgId: string;
}

export function NewRoleForm({ orgId }: NewRoleFormProps) {
  const router = useRouter();
  const { createRole } = useRoleMutations();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const handleSubmit = async (values: RoleFormValues) => {
    setIsSubmitting(true);
    setServerError(null);
    try {
      await createRole(values);
      router.push(`/${orgId}/settings/roles`);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Failed to create role');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    router.push(`/${orgId}/settings/roles`);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Create a custom role for this organization</CardTitle>
          <CardDescription>
            Define what this role can do. After saving, assign people to it in Gideon — a new role
            alone grants nobody access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RoleForm
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isSubmitting={isSubmitting}
            submitLabel="Create role"
          />
          {serverError && <p className="mt-3 text-sm text-destructive">{serverError}</p>}
          <div className="mt-4">
            <Link className="text-sm underline" href={`/${orgId}/settings/roles`}>
              Back to roles
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
