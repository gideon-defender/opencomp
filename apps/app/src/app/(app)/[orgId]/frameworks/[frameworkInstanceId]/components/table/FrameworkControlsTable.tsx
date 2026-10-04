'use client';

import { Loading } from '@/components/tables/risk-tasks/loading';
import { Table, TableBody, TableCell, TableRow } from '@gideon-defender/ui/table';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import {
  FrameworkControlsTableColumns,
  type OrganizationControlType,
} from './FrameworkControlsTableColumns';
import { FrameworkControlsTableHeader } from './FrameworkControlsTableHeader';

interface DataTableProps {
  data: OrganizationControlType[];
}

export function FrameworkControlsTable({ data }: DataTableProps) {
  const t = useTranslations('frameworks');
  const columns = FrameworkControlsTableColumns();

  // eslint-disable-next-line react-hooks/incompatible-library -- React Compiler intentional skip: TanStack useReactTable() returns non-memoizable functions
  const table = useReactTable({
    data: data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <Suspense fallback={<Loading isEmpty={false} />}>
      <div className="w-full overflow-auto">
        <Table>
          <FrameworkControlsTableHeader table={table} />
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="h-[45px]"
                  data-state={row.getIsSelected() && 'selected'}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="px-3 py-2 md:px-4">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  {t('controlsTable.noControls')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Suspense>
  );
}
