'use client';

import * as React from 'react';

import { StatusIndicator } from '@/components/status-indicator';
import { usePermissions } from '@/hooks/use-permissions';
import {
  Button,
  DataTableFilters,
  DataTableHeader,
  DataTableSearch,
  HStack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@trycompai/design-system';
import { ArrowDown, ArrowUp } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ControlWithRelations } from '../data/queries';
import { getControlStatus } from '../lib/utils';

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100];

interface ControlsTableProps {
  promises: Promise<[{ data: ControlWithRelations[]; pageCount: number }]>;
}

type SortDirection = 'asc' | 'desc';

function SortIcon({ direction }: { direction: SortDirection }) {
  return direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
}

export function ControlsTable({ promises }: ControlsTableProps) {
  const [{ data }] = React.use(promises);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { hasPermission } = usePermissions();
  const t = useTranslations('controls');
  const tCommon = useTranslations('overview');
  const [search, setSearch] = React.useState('');
  const [sortDirection, setSortDirection] = React.useState<SortDirection>('asc');
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE);

  // Reset to page 1 when search changes
  const [prevSearch, setPrevSearch] = React.useState(search);
  if (prevSearch !== search) {
    setPrevSearch(search);
    setPage(1);
  }

  const filteredControls = React.useMemo(() => {
    const lowerSearch = search.toLowerCase().trim();
    const filtered = lowerSearch
      ? data.filter((control) => control.name.toLowerCase().includes(lowerSearch))
      : data;
    const sorted = [...filtered].sort((left, right) =>
      sortDirection === 'asc'
        ? left.name.localeCompare(right.name)
        : right.name.localeCompare(left.name),
    );
    return sorted;
  }, [data, search, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(filteredControls.length / pageSize));
  const startIndex = (page - 1) * pageSize;
  const paginatedControls = filteredControls.slice(startIndex, startIndex + pageSize);

  // Keep page in bounds when pageCount changes
  if (page > pageCount) {
    setPage(pageCount);
  }

  const handleSortByName = React.useCallback(() => {
    setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
  }, []);

  const handleOpenCreateControl = React.useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('create-control', 'true');
    router.push(`${pathname}?${params.toString()}`);
  }, [pathname, router, searchParams]);

  const handleViewControl = React.useCallback(
    (controlId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      router.push(`${pathname}/${controlId}${params.toString() ? `?${params.toString()}` : ''}`);
    },
    [pathname, router, searchParams],
  );

  const handleRowKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTableRowElement>, controlId: string) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleViewControl(controlId);
      }
    },
    [handleViewControl],
  );

  const handlePageSizeChange = React.useCallback((nextPageSize: number) => {
    setPageSize(nextPageSize);
    setPage(1);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <DataTableHeader>
        <DataTableSearch placeholder={t('searchPlaceholder')} value={search} onChange={setSearch} />
        <DataTableFilters>
          {hasPermission('control', 'create') && (
            <Button onClick={handleOpenCreateControl}>{t('createControl')}</Button>
          )}
        </DataTableFilters>
      </DataTableHeader>
      <Table
        variant="bordered"
        pagination={{
          page,
          pageCount,
          onPageChange: setPage,
          pageSize,
          pageSizeOptions: PAGE_SIZE_OPTIONS,
          onPageSizeChange: handlePageSizeChange,
        }}
      >
        <TableHeader>
          <TableRow>
            <TableHead>
              <HStack
                gap="xs"
                align="center"
                style={{ cursor: 'pointer' }}
                onClick={handleSortByName}
              >
                <span>{t('controlName')}</span>
                <SortIcon direction={sortDirection} />
              </HStack>
            </TableHead>
            <TableHead>{tCommon('common.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {paginatedControls.length === 0 ? (
            <TableRow>
              <TableCell colSpan={2}>
                <Text size="sm" variant="muted">
                  {t('noControlsFound')}
                </Text>
              </TableCell>
            </TableRow>
          ) : (
            paginatedControls.map((control) => (
              <TableRow
                key={control.id}
                role="button"
                tabIndex={0}
                onClick={() => handleViewControl(control.id)}
                onKeyDown={(event) => handleRowKeyDown(event, control.id)}
              >
                <TableCell>
                  <Text size="sm" weight="medium">
                    {control.name}
                  </Text>
                </TableCell>
                <TableCell>
                  <StatusIndicator status={getControlStatus(control)} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
