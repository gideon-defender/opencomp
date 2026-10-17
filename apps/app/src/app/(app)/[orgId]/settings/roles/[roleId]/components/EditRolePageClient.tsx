'use client';

import { usePermissions } from '@/hooks/use-permissions';
import { Button } from '@gideon-defender/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@gideon-defender/ui/card';
import { Input } from '@gideon-defender/ui/input';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RoleForm, type RoleFormValues } from '../../components/RoleForm';
import type { CustomRole } from '../../components/RolesTable';
import { useRoleMutations } from '../../hooks/useRoles';

interface EditRolePageClientProps {
  orgId: string;
  initialData: CustomRole;
}

export function EditRolePageClient({ orgId, initialData }: EditRolePageClientProps) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const { updateRole, deleteRole, fetchRole, refreshRoles } = useRoleMutations();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');
  // Holder count is a snapshot of the SSR prop — assignments can land after
  // load, so every server rejection re-reads the fresh role instead of
  // trusting this number.
  const [holders, setHolders] = useState(initialData._count?.members ?? 0);
  // Set when the server rejects a rename for missing confirmRename: the
  // page-load holder count is stale (assignments landed after load), so the
  // confirm box below renders on server demand, not just on stale holders.
  const [confirmRequired, setConfirmRequired] = useState(false);

  const canUpdate = hasPermission('ac', 'update');
  const canDelete = hasPermission('ac', 'delete');

  const refreshHolderCount = async () => {
    try {
      const fresh = await fetchRole(initialData.id);
      setHolders(fresh._count?.members ?? 0);
      await refreshRoles();
    } catch {
      // Keep the last known count — the server error text already explains.
    }
  };

  const handleSubmit = async (values: RoleFormValues) => {
    const isRename = values.name.trim() !== initialData.name;
    const needsConfirm = isRename && (holders > 0 || confirmRequired);
    if (needsConfirm && confirmName !== initialData.name) {
      setServerError(
        `To confirm the rename, type the current name "${initialData.name}" in the warning box above.`,
      );
      return;
    }
    setIsSubmitting(true);
    setServerError(null);
    try {
      await updateRole(initialData.id, {
        ...values,
        ...(needsConfirm ? { confirmRename: true } : {}),
      });
      router.push(`/${orgId}/settings/roles`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update role';
      // The server re-counts holders fresh: a 400 naming confirmRename means
      // assignments landed after this page loaded. Re-read the count so the
      // confirm box shows the fresh number, then surface the box so the retry
      // carries the flag instead of 400-looping.
      if (isRename && /confirmRename/.test(message)) {
        setConfirmRequired(true);
        await refreshHolderCount();
      }
      setServerError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    router.push(`/${orgId}/settings/roles`);
  };

  const handleDelete = async () => {
    if (holders > 0) return;
    if (
      !window.confirm(
        `Delete role "${initialData.name}"? This cannot be undone. Ensure nobody holds it — holders must be removed in Gideon first.`,
      )
    ) {
      return;
    }
    setIsDeleting(true);
    setServerError(null);
    try {
      await deleteRole(initialData.id);
      router.push(`/${orgId}/settings/roles`);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Failed to delete role');
      // The list may be stale (holders appeared after load, so the server
      // 409d). Re-read so the page shows the fresh member count and stops
      // offering a delete that cannot succeed.
      await refreshHolderCount();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Edit role: {initialData.name}</CardTitle>
          <CardDescription>
            Editing changes what &apos;{initialData.name}&apos; can do, immediately. It does not
            change who has &apos;{initialData.name}&apos; — manage that in Gideon.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canUpdate ? (
            <>
              {(holders > 0 || confirmRequired) && (
                <div className="mb-4 flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">
                      {holders > 0 ? (
                        <>
                          {holders} members currently hold &apos;{initialData.name}&apos;.
                        </>
                      ) : (
                        <>Members currently hold &apos;{initialData.name}&apos;.</>
                      )}
                    </p>
                    <p className="text-muted-foreground">
                      Renaming takes effect for enforcement immediately, but those members keep the
                      old name until Gideon assignments are renamed — they lose these permissions in
                      the meantime. Prefer creating a new role and migrating assignments. To confirm
                      a rename, type the current name below.
                    </p>
                    <Input
                      className="mt-2 max-w-xs"
                      placeholder={initialData.name}
                      value={confirmName}
                      onChange={(e) => setConfirmName(e.target.value)}
                    />
                  </div>
                </div>
              )}
              <RoleForm
                defaultValues={{
                  name: initialData.name,
                  permissions: initialData.permissions,
                  obligations: initialData.obligations,
                }}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                isSubmitting={isSubmitting}
                submitLabel="Save changes"
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              You do not have permission to edit roles.
            </p>
          )}
          {serverError && <p className="mt-3 text-sm text-destructive">{serverError}</p>}
          <div className="mt-4">
            <Link className="text-sm underline" href={`/${orgId}/settings/roles`}>
              Back to roles
            </Link>
          </div>
        </CardContent>
      </Card>

      {canDelete && (
        <Card>
          <CardHeader>
            <CardTitle>Delete role</CardTitle>
            <CardDescription>
              Deleting removes the definition. It never reassigns anyone — assignments stay in
              Gideon.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {holders > 0 ? (
              <p className="text-sm text-muted-foreground">
                {holders} members currently hold this role. Remove assignments in Gideon first (they
                clear at next login/reconciliation), then retry.
              </p>
            ) : (
              <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? 'Deleting...' : `Delete ${initialData.name}`}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
