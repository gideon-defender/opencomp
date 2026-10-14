'use client';

import { formatDateShort } from '@/lib/format';

import { InputGroup, InputGroupAddon, InputGroupInput } from '@gideon-defender/ui/input-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gideon-defender/ui/table';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

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

  const filteredRoles = useMemo(() => {
    if (!search.trim()) return roles;
    const lowerSearch = search.toLowerCase();
    return roles.filter((role) => role.name.toLowerCase().includes(lowerSearch));
  }, [roles, search]);

  const formatDate = (date: string | null | undefined): string => formatDateShort(date) || '-';

  const getPermissionCount = (permissions: Record<string, string[]>) => {
    return Object.keys(permissions).length;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        OpenComp defines role permissions. Manage role assignments in Gideon. This list is
        read-only.
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
      </div>

      {/* Table */}
      <Table className="border">
        <TableHeader>
          <TableRow>
            <TableHead>NAME</TableHead>
            <TableHead>PERMISSIONS</TableHead>
            <TableHead>CREATED</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredRoles.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3}>
                <div className="flex items-center justify-center py-8">
                  <span className="text-muted-foreground">
                    {search ? 'No roles match your search' : 'No custom roles yet'}
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            filteredRoles.map((role) => (
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
                  <span className="text-sm text-muted-foreground">
                    {formatDate(role.createdAt)}
                  </span>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
