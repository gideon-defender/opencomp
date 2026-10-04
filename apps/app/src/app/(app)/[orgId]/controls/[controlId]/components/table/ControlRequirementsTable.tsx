'use client';

import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';

import type { FrameworkEditorRequirement, Policy, Task } from '@db';
import { Table, TableBody, TableCell, TableRow } from '@gideon-defender/ui/table';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { getControlRequirementsColumns } from './ControlRequirementsTableColumns';
import { ControlRequirementsTableHeader } from './ControlRequirementsTableHeader';

// Define the type that matches what we receive from the hook
export type RequirementTableData = FrameworkEditorRequirement & {
  policy: Policy | null;
  task: Task | null;
};

interface DataTableProps {
  data: RequirementTableData[];
}

export function ControlRequirementsTable({ data }: DataTableProps) {
  const router = useRouter();
  const { orgId } = useParams<{ orgId: string }>();
  const t = useTranslations('controls');
  const tCommon = useTranslations('overview');

  const columns = useMemo(() => getControlRequirementsColumns(t, tCommon), [t, tCommon]);

  // TanStack Table returns non-memoizable functions — intentional
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const onRowClick = (requirement: RequirementTableData) => {
    switch (requirement.policy ? 'policy' : 'task') {
      case 'policy':
        if (requirement.policy?.id) {
          router.push(`/${orgId}/policies/${requirement.policy.id}`);
        }
        break;
      case 'task':
        if (requirement.task?.id) {
          router.push(`/${orgId}/tasks/${requirement.task.id}`);
        }
        break;
      default:
        break;
    }
  };

  return (
    <div className="relative w-full">
      <div className="overflow-auto">
        <Table>
          <ControlRequirementsTableHeader table={table} />
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  className="hover:bg-muted/50 cursor-pointer"
                  onClick={() => onRowClick(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="p-4">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  {t('noRequirementsFound')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
