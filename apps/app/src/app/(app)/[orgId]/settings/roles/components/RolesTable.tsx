'use client';

import { usePermissions } from '@/hooks/use-permissions';
import { formatDateShort } from '@/lib/format';

import { Button } from '@gideon-defender/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@gideon-defender/ui/input-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gideon-defender/ui/table';
import { Pencil, Plus, Search, Trash } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useRoleMutations } from '../hooks/useRoles';

export interface CustomRole {
  id: string;
  name: string;
  permissions: Record<string, string[]>;
  obligations: Record<string, boolean>;
  isBuiltIn: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    members: number;
  };
}

interface RolesTableProps {
  roles: CustomRole[];
}

export function RolesTable({ roles }: RolesTableProps) {
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const router = useRouter();
  const params = useParams();
  const orgId = params.orgId as string;
  const { hasPermission } = usePermissions();
  const { deleteRole, refreshRoles } = useRoleMutations();

  const canCreate = hasPermission('ac', 'create');
  const canUpdate = hasPermission('ac', 'update');
  const canDelete = hasPermission('ac', 'delete');

  const filteredRoles = useMemo(() => {
    if (!search.trim()) return roles;
    const lowerSearch = search.toLowerCase();
    return roles.filter((role) => role.name.toLowerCase().includes(lowerSearch));
  }, [roles, search]);

  const formatDate = (date: string | null | undefined): string => formatDateShort(date) || '-';

  const getPermissionCount = (permissions: Record<string, string[]>) => {
    return Object.keys(permissions).length;
  };

  const handleDelete = async (role: CustomRole) => {
    const holders = role._count?.members ?? 0;
    if (holders > 0) return;
    if (
      !window.confirm(
        `Delete role "${role.name}"? This cannot be undone. Ensure nobody holds it — holders must be removed in Gideon first.`,
      )
    ) {
      return;
    }
    setDeletingId(role.id);
    try {
      await deleteRole(role.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to delete role');
      // The list may be stale (holders appeared after load, so the server
      // 409d). Revalidate so the row shows the fresh member count instead of
      // staying deletable forever.
      await refreshRoles();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        Define what each role can do here. Who gets a role is assigned in Gideon — OpenComp never
        assigns roles to people.
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full md:max-w-[300px]">
          <InputGroup>
            <InputGroupAddon>
              <Search size={16} />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search roles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>
        </div>
        {canCreate && (
          <Button onClick={() => router.push(`/${orgId}/settings/roles/new`)}>
            <Plus className="h-4 w-4" />
            New role
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <Table className="border">
          <TableHeader>
            <TableRow>
              <TableHead>NAME</TableHead>
              <TableHead>PERMISSIONS</TableHead>
              <TableHead>MEMBERS</TableHead>
              <TableHead>CREATED</TableHead>
              <TableHead>UPDATED</TableHead>
              {(canUpdate || canDelete) && <TableHead>ACTIONS</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRoles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="flex items-center justify-center py-8">
                    <span className="text-muted-foreground">
                      {search ? 'No roles match your search' : 'No custom roles yet'}
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredRoles.map((role) => {
                const holders = role._count?.members ?? 0;
                return (
                  <TableRow key={role.id}>
                    <TableCell>
                      <span className="text-sm font-medium">{role.name}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {getPermissionCount(role.permissions)} resources
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{holders}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {formatDate(role.createdAt)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {formatDate(role.updatedAt)}
                      </span>
                    </TableCell>
                    {(canUpdate || canDelete) && (
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {canUpdate && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => router.push(`/${orgId}/settings/roles/${role.id}`)}
                            >
                              <Pencil className="h-4 w-4" />
                              View/Edit
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={holders > 0 || deletingId === role.id}
                              title={
                                holders > 0 ? 'Remove assignments in Gideon first' : 'Delete role'
                              }
                              onClick={() => handleDelete(role)}
                            >
                              <Trash className="h-4 w-4" />
                              Delete
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
