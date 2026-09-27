'use client';

import type { Column, ColumnMeta, Table } from '@tanstack/react-table';
import {
  CalendarIcon,
  Check,
  ChevronsUpDown,
  GripVertical,
  ListFilter,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsStringEnum, useQueryState } from 'nuqs';
import * as React from 'react';

import { getDefaultFilterOperator, getFilterOperators } from '@/lib/data-table';
import { dataTableConfig } from '@/lib/data-table-config';
import { formatDate } from '@/lib/format';
import { generateId } from '@/lib/id';
import type { ExtendedColumnFilter, FilterOperator, JoinOperator } from '@/types/data-table';
import { Badge } from '@gideon-defender/ui/badge';
import { Button } from '@gideon-defender/ui/button';
import { Calendar } from '@gideon-defender/ui/calendar';
import { cn } from '@gideon-defender/ui/cn';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@gideon-defender/ui/command';
import { Input } from '@gideon-defender/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@gideon-defender/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gideon-defender/ui/select';
import { DataTableRangeFilter } from './data-table-range-filter';
import {
  Faceted,
  FacetedBadgeList,
  FacetedContent,
  FacetedEmpty,
  FacetedGroup,
  FacetedInput,
  FacetedItem,
  FacetedList,
  FacetedTrigger,
} from './faceted';
import { useDebouncedFilters } from './hooks/use-debounced-filters';
import {
  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
  SortableOverlay,
} from './sortable';

const JOIN_OPERATOR_KEY = 'joinOperator';
const DEBOUNCE_MS = 300;
const THROTTLE_MS = 50;
const OPEN_MENU_SHORTCUT = 'f';
const REMOVE_FILTER_SHORTCUTS = ['backspace', 'delete'];

type DataTableTranslations = ReturnType<typeof useDataTableTranslations>;

function useDataTableTranslations() {
  return useTranslations('dataTable');
}

interface DataTableFilterListProps<TData> extends React.ComponentProps<typeof PopoverContent> {
  table: Table<TData>;
  debounceMs?: number;
  throttleMs?: number;
  shallow?: boolean;
}

export function DataTableFilterList<TData>({
  table,
  debounceMs = DEBOUNCE_MS,
  throttleMs = THROTTLE_MS,
  shallow = true,
  ...props
}: DataTableFilterListProps<TData>) {
  const t = useTranslations('dataTable');
  const id = React.useId();
  const labelId = React.useId();
  const descriptionId = React.useId();
  const [open, setOpen] = React.useState(false);
  const addButtonRef = React.useRef<HTMLButtonElement>(null);

  const columns = React.useMemo(() => {
    return table.getAllColumns().filter((column) => column.columnDef.enableColumnFilter);
  }, [table]);

  const { filters, setFilters, debouncedSetFilters } = useDebouncedFilters<TData>({
    columnIds: columns.map((field) => field.id),
    debounceMs,
    throttleMs,
    shallow,
  });

  const [joinOperator, setJoinOperator] = useQueryState(
    JOIN_OPERATOR_KEY,
    parseAsStringEnum(['and', 'or']).withDefault('and').withOptions({
      clearOnDefault: true,
      shallow,
    }),
  );

  const onFilterAdd = React.useCallback(() => {
    const column = columns[0];

    if (!column) return;

    debouncedSetFilters([
      ...filters,
      {
        id: column.id as Extract<keyof TData, string>,
        value: '',
        variant: column.columnDef.meta?.variant ?? 'text',
        operator: getDefaultFilterOperator(column.columnDef.meta?.variant ?? 'text'),
        filterId: generateId({ length: 8 }),
      },
    ]);
  }, [columns, filters, debouncedSetFilters]);

  const onFilterUpdate = React.useCallback(
    (filterId: string, updates: Partial<Omit<ExtendedColumnFilter<TData>, 'filterId'>>) => {
      debouncedSetFilters((prevFilters) => {
        const updatedFilters = prevFilters.map((filter) => {
          if (filter.filterId === filterId) {
            return {
              ...filter,
              ...updates,
            } as ExtendedColumnFilter<TData>;
          }
          return filter;
        });
        return updatedFilters;
      });
    },
    [debouncedSetFilters],
  );

  const onFilterRemove = React.useCallback(
    (filterId: string) => {
      const updatedFilters = filters.filter((filter) => filter.filterId !== filterId);
      void setFilters(updatedFilters);
      requestAnimationFrame(() => {
        addButtonRef.current?.focus();
      });
    },
    [filters, setFilters],
  );

  const onFiltersReset = React.useCallback(() => {
    void setFilters(null);
    void setJoinOperator('and');
  }, [setFilters, setJoinOperator]);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (
        event.key.toLowerCase() === OPEN_MENU_SHORTCUT &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        setOpen(true);
      }

      if (event.key.toLowerCase() === OPEN_MENU_SHORTCUT && event.shiftKey && filters.length > 0) {
        event.preventDefault();
        onFilterRemove(filters[filters.length - 1]?.filterId ?? '');
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filters, onFilterRemove]);

  const onTriggerKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (REMOVE_FILTER_SHORTCUTS.includes(event.key.toLowerCase()) && filters.length > 0) {
        event.preventDefault();
        onFilterRemove(filters[filters.length - 1]?.filterId ?? '');
      }
    },
    [filters, onFilterRemove],
  );

  return (
    <Sortable value={filters} onValueChange={setFilters} getItemValue={(item) => item.filterId}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" onKeyDown={onTriggerKeyDown}>
            <ListFilter />
            {t('filter')}
            {filters.length > 0 && (
              <Badge
                variant="secondary"
                className="h-[18.24px] rounded-[3.2px] px-[5.12px] font-mono text-[10.4px] font-normal"
              >
                {filters.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          aria-describedby={descriptionId}
          aria-labelledby={labelId}
          className="flex w-full max-w-[var(--radix-popover-content-available-width)] origin-[var(--radix-popover-content-transform-origin)] flex-col gap-3.5 p-4 sm:min-w-[380px]"
          {...props}
        >
          <div className="relative flex flex-col gap-1">
            <h4 id={labelId} className="leading-none font-medium">
              {filters.length > 0 ? t('filters') : t('noFiltersApplied')}
            </h4>
            <p
              id={descriptionId}
              className={cn('text-muted-foreground text-sm', filters.length > 0 && 'sr-only')}
            >
              {filters.length > 0 ? t('modifyFiltersHint') : t('addFiltersHint')}
            </p>
          </div>
          {filters.length > 0 ? (
            <SortableContent asChild>
              <div className="flex max-h-[300px] flex-col gap-2 overflow-y-auto p-1">
                {filters.map((filter, index) => (
                  <DataTableFilterItem<TData>
                    key={filter.filterId}
                    filter={filter}
                    index={index}
                    filterItemId={`${id}-filter-${filter.filterId}`}
                    joinOperator={joinOperator}
                    setJoinOperator={setJoinOperator}
                    columns={columns}
                    onFilterUpdate={onFilterUpdate}
                    onFilterRemove={onFilterRemove}
                  />
                ))}
              </div>
            </SortableContent>
          ) : null}
          <div className="flex w-full items-center gap-2">
            <Button size="sm" className="rounded-sm" ref={addButtonRef} onClick={onFilterAdd}>
              {t('addFilter')}
            </Button>
            {filters.length > 0 ? (
              <Button variant="outline" size="sm" className="rounded-sm" onClick={onFiltersReset}>
                {t('resetFilters')}
              </Button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      <SortableOverlay>
        <div className="flex items-center gap-2">
          <div className="bg-primary/10 h-8 min-w-[72px] rounded-sm" />
          <div className="bg-primary/10 h-8 w-32 rounded-sm" />
          <div className="bg-primary/10 h-8 w-32 rounded-sm" />
          <div className="bg-primary/10 h-8 min-w-36 flex-1 rounded-sm" />
          <div className="bg-primary/10 size-8 shrink-0 rounded-sm" />
          <div className="bg-primary/10 size-8 shrink-0 rounded-sm" />
        </div>
      </SortableOverlay>
    </Sortable>
  );
}

interface DataTableFilterItemProps<TData> {
  filter: ExtendedColumnFilter<TData>;
  index: number;
  filterItemId: string;
  joinOperator: JoinOperator;
  setJoinOperator: (value: JoinOperator) => void;
  columns: Column<TData>[];
  onFilterUpdate: (
    filterId: string,
    updates: Partial<Omit<ExtendedColumnFilter<TData>, 'filterId'>>,
  ) => void;
  onFilterRemove: (filterId: string) => void;
}

function DataTableFilterItem<TData>({
  filter,
  index,
  filterItemId,
  joinOperator,
  setJoinOperator,
  columns,
  onFilterUpdate,
  onFilterRemove,
}: DataTableFilterItemProps<TData>) {
  const t = useTranslations('dataTable');
  const [showFieldSelector, setShowFieldSelector] = React.useState(false);
  const [showOperatorSelector, setShowOperatorSelector] = React.useState(false);
  const [showValueSelector, setShowValueSelector] = React.useState(false);

  const onItemKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (showFieldSelector || showOperatorSelector || showValueSelector) {
        return;
      }

      if (REMOVE_FILTER_SHORTCUTS.includes(event.key.toLowerCase())) {
        event.preventDefault();
        onFilterRemove(filter.filterId);
      }
    },
    [filter.filterId, showFieldSelector, showOperatorSelector, showValueSelector, onFilterRemove],
  );

  const column = columns.find((column) => column.id === filter.id);
  if (!column) return null;

  const joinOperatorListboxId = `${filterItemId}-join-operator-listbox`;
  const fieldListboxId = `${filterItemId}-field-listbox`;
  const operatorListboxId = `${filterItemId}-operator-listbox`;
  const inputId = `${filterItemId}-input`;

  const columnMeta = column.columnDef.meta;
  const filterOperators = getFilterOperators(filter.variant);

  return (
    <SortableItem value={filter.filterId} asChild>
      <div
        id={filterItemId}
        tabIndex={-1}
        className="flex items-center gap-2"
        onKeyDown={onItemKeyDown}
      >
        <div className="min-w-[72px] text-center">
          {index === 0 ? (
            <span className="text-muted-foreground text-sm">{t('where')}</span>
          ) : index === 1 ? (
            <Select
              value={joinOperator}
              onValueChange={(value: JoinOperator) => setJoinOperator(value)}
            >
              <SelectTrigger
                aria-label={t('selectJoinOperator')}
                aria-controls={joinOperatorListboxId}
                className="h-8 rounded-sm lowercase [&[data-size]]:h-8"
              >
                <SelectValue placeholder={joinOperator} />
              </SelectTrigger>
              <SelectContent
                id={joinOperatorListboxId}
                position="popper"
                className="min-w-(--radix-select-trigger-width) lowercase"
              >
                {dataTableConfig.joinOperators.map((joinOperator) => (
                  <SelectItem key={joinOperator} value={joinOperator}>
                    {joinOperator}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-muted-foreground text-sm">{joinOperator}</span>
          )}
        </div>
        <Popover open={showFieldSelector} onOpenChange={setShowFieldSelector}>
          <PopoverTrigger asChild>
            <Button
              aria-controls={fieldListboxId}
              variant="outline"
              size="sm"
              className="w-32 justify-between rounded-sm font-normal"
            >
              <span className="truncate">
                {columns.find((column) => column.id === filter.id)?.columnDef.meta?.label ??
                  t('selectField')}
              </span>
              <ChevronsUpDown className="opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            id={fieldListboxId}
            align="start"
            className="w-40 origin-[var(--radix-popover-content-transform-origin)] p-0"
          >
            <Command>
              <CommandInput placeholder={t('searchFields')} />
              <CommandList>
                <CommandEmpty>{t('noFieldsFound')}</CommandEmpty>
                <CommandGroup>
                  {columns.map((column) => (
                    <CommandItem
                      key={column.id}
                      value={column.id}
                      onSelect={(value) => {
                        onFilterUpdate(filter.filterId, {
                          id: value as Extract<keyof TData, string>,
                          variant: column.columnDef.meta?.variant ?? 'text',
                          operator: getDefaultFilterOperator(
                            column.columnDef.meta?.variant ?? 'text',
                          ),
                          value: '',
                        });

                        setShowFieldSelector(false);
                      }}
                    >
                      <span className="truncate">{column.columnDef.meta?.label}</span>
                      <Check
                        className={cn(
                          'ml-auto',
                          column.id === filter.id ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Select
          open={showOperatorSelector}
          onOpenChange={setShowOperatorSelector}
          value={filter.operator}
          onValueChange={(value: FilterOperator) =>
            onFilterUpdate(filter.filterId, {
              operator: value,
              value: value === 'isEmpty' || value === 'isNotEmpty' ? '' : filter.value,
            })
          }
        >
          <SelectTrigger
            aria-controls={operatorListboxId}
            className="h-8 w-32 rounded-sm lowercase [&[data-size]]:h-8"
          >
            <div className="truncate">
              <SelectValue placeholder={filter.operator} />
            </div>
          </SelectTrigger>
          <SelectContent
            id={operatorListboxId}
            className="origin-[var(--radix-select-content-transform-origin)]"
          >
            {filterOperators.map((operator) => (
              <SelectItem key={operator.value} value={operator.value} className="lowercase">
                {operator.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="min-w-36 flex-1">
          {onFilterInputRender({
            filter,
            inputId,
            column,
            columnMeta,
            onFilterUpdate,
            showValueSelector,
            setShowValueSelector,
            t,
          })}
        </div>
        <Button
          aria-controls={filterItemId}
          variant="outline"
          size="icon"
          className="size-8 rounded-sm"
          onClick={() => onFilterRemove(filter.filterId)}
        >
          <Trash2 />
        </Button>
        <SortableItemHandle asChild>
          <Button variant="outline" size="icon" className="size-8 rounded-sm">
            <GripVertical />
          </Button>
        </SortableItemHandle>
      </div>
    </SortableItem>
  );
}

function onFilterInputRender<TData>({
  filter,
  inputId,
  column,
  columnMeta,
  onFilterUpdate,
  showValueSelector,
  setShowValueSelector,
  t,
}: {
  filter: ExtendedColumnFilter<TData>;
  inputId: string;
  column: Column<TData>;
  columnMeta?: ColumnMeta<TData, unknown>;
  onFilterUpdate: (
    filterId: string,
    updates: Partial<Omit<ExtendedColumnFilter<TData>, 'filterId'>>,
  ) => void;
  showValueSelector: boolean;
  setShowValueSelector: (value: boolean) => void;
  t: DataTableTranslations;
}) {
  if (filter.operator === 'isEmpty' || filter.operator === 'isNotEmpty') {
    const columnLabel: string = columnMeta?.label ?? column.id;
    const labelValues: { label: string } = { label: columnLabel };
    const emptyLabel =
      filter.operator === 'isEmpty'
        ? t('filterIsEmpty', labelValues)
        : t('filterIsNotEmpty', labelValues);
    return (
      <div
        id={inputId}
        role="status"
        aria-label={emptyLabel}
        aria-live="polite"
        className="dark:bg-input/30 h-8 w-full rounded-sm border bg-transparent"
      />
    );
  }

  switch (filter.variant) {
    case 'text':
    case 'number':
    case 'range': {
      if (
        (filter.variant === 'range' && filter.operator === 'isBetween') ||
        filter.operator === 'isBetween'
      ) {
        return (
          <DataTableRangeFilter
            filter={filter}
            column={column}
            inputId={inputId}
            onFilterUpdate={onFilterUpdate}
          />
        );
      }

      const isNumber = filter.variant === 'number' || filter.variant === 'range';

      return (
        <Input
          id={inputId}
          type={isNumber ? 'number' : filter.variant}
          aria-label={t('filterValue', { label: columnMeta?.label ?? column.id })}
          aria-describedby={`${inputId}-description`}
          inputMode={isNumber ? 'numeric' : undefined}
          placeholder={columnMeta?.placeholder ?? t('enterAValue')}
          className="h-8 w-full rounded-sm"
          defaultValue={typeof filter.value === 'string' ? filter.value : undefined}
          onChange={(event) =>
            onFilterUpdate(filter.filterId, {
              value: event.target.value,
            })
          }
        />
      );
    }

    case 'boolean': {
      if (Array.isArray(filter.value)) return null;

      const inputListboxId = `${inputId}-listbox`;

      return (
        <Select
          open={showValueSelector}
          onOpenChange={setShowValueSelector}
          value={filter.value}
          onValueChange={(value) =>
            onFilterUpdate(filter.filterId, {
              value,
            })
          }
        >
          <SelectTrigger
            id={inputId}
            aria-controls={inputListboxId}
            aria-label={t('booleanFilter', { label: columnMeta?.label ?? column.id })}
            className="h-8 w-full rounded-sm [&[data-size]]:h-8"
          >
            <SelectValue placeholder={filter.value ? t('trueLabel') : t('falseLabel')} />
          </SelectTrigger>
          <SelectContent id={inputListboxId}>
            <SelectItem value="true">{t('trueLabel')}</SelectItem>
            <SelectItem value="false">{t('falseLabel')}</SelectItem>
          </SelectContent>
        </Select>
      );
    }

    case 'select':
    case 'multiSelect': {
      const inputListboxId = `${inputId}-listbox`;

      const multiple = filter.variant === 'multiSelect';
      const selectedValues = multiple
        ? Array.isArray(filter.value)
          ? filter.value
          : []
        : typeof filter.value === 'string'
          ? filter.value
          : undefined;

      return (
        <Faceted
          open={showValueSelector}
          onOpenChange={setShowValueSelector}
          value={selectedValues}
          onValueChange={(value) => {
            onFilterUpdate(filter.filterId, {
              value,
            });
          }}
          multiple={multiple}
        >
          <FacetedTrigger asChild>
            <Button
              id={inputId}
              aria-controls={inputListboxId}
              aria-label={t(multiple ? 'filterValues' : 'filterValue', {
                label: columnMeta?.label ?? column.id,
              })}
              variant="outline"
              size="sm"
              className="w-full rounded-sm font-normal"
            >
              <FacetedBadgeList
                options={columnMeta?.options}
                placeholder={columnMeta?.placeholder ?? (multiple ? t('selectOptions') : t('selectOption'))}
              />
            </Button>
          </FacetedTrigger>
          <FacetedContent
            id={inputListboxId}
            className="w-[200px] origin-[var(--radix-popover-content-transform-origin)]"
          >
            <FacetedInput
              aria-label={t('searchFieldOptions', { label: columnMeta?.label ?? column.id })}
              placeholder={columnMeta?.placeholder ?? t('searchOptions')}
            />
            <FacetedList>
              <FacetedEmpty>{t('noOptionsFound')}</FacetedEmpty>
              <FacetedGroup>
                {columnMeta?.options?.map((option) => (
                  <FacetedItem key={option.value} value={option.value}>
                    {option.icon && <option.icon />}
                    <span>{option.label}</span>
                    {option.count && (
                      <span className="ml-auto font-mono text-xs">{option.count}</span>
                    )}
                  </FacetedItem>
                ))}
              </FacetedGroup>
            </FacetedList>
          </FacetedContent>
        </Faceted>
      );
    }

    case 'date':
    case 'dateRange': {
      const inputListboxId = `${inputId}-listbox`;

      const dateValue = Array.isArray(filter.value)
        ? filter.value.filter(Boolean)
        : [filter.value, filter.value].filter(Boolean);

      const displayValue =
        filter.operator === 'isBetween' && dateValue.length === 2
          ? `${formatDate(new Date(Number(dateValue[0])))} - ${formatDate(
              new Date(Number(dateValue[1])),
            )}`
          : dateValue[0]
            ? formatDate(new Date(Number(dateValue[0])))
            : t('pickADate');

      return (
        <Popover open={showValueSelector} onOpenChange={setShowValueSelector}>
          <PopoverTrigger asChild>
            <Button
              id={inputId}
              aria-controls={inputListboxId}
              aria-label={t('dateFilter', { label: columnMeta?.label ?? column.id })}
              variant="outline"
              size="sm"
              className={cn(
                'w-full justify-start rounded-sm text-left font-normal',
                !filter.value && 'text-muted-foreground',
              )}
            >
              <CalendarIcon />
              <span className="truncate">{displayValue}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            id={inputListboxId}
            align="start"
            className="w-auto origin-[var(--radix-popover-content-transform-origin)] p-0"
          >
            {filter.operator === 'isBetween' ? (
              <Calendar
                aria-label={t('selectDateRange', { label: columnMeta?.label ?? column.id })}
                mode="range"
                initialFocus
                selected={
                  dateValue.length === 2
                    ? {
                        from: new Date(Number(dateValue[0])),
                        to: new Date(Number(dateValue[1])),
                      }
                    : {
                        from: new Date(),
                        to: new Date(),
                      }
                }
                onSelect={(date) => {
                  onFilterUpdate(filter.filterId, {
                    value: date
                      ? [
                          (date.from?.getTime() ?? '').toString(),
                          (date.to?.getTime() ?? '').toString(),
                        ]
                      : [],
                  });
                }}
              />
            ) : (
              <Calendar
                aria-label={t('selectDate', { label: columnMeta?.label ?? column.id })}
                mode="single"
                initialFocus
                selected={dateValue[0] ? new Date(Number(dateValue[0])) : undefined}
                onSelect={(date) => {
                  onFilterUpdate(filter.filterId, {
                    value: (date?.getTime() ?? '').toString(),
                  });
                }}
              />
            )}
          </PopoverContent>
        </Popover>
      );
    }

    default:
      return null;
  }
}
