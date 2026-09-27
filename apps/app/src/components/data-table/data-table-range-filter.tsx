'use client';

import type { Column } from '@tanstack/react-table';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';

import type { ExtendedColumnFilter } from '@/types/data-table';
import { cn } from '@gideon-defender/ui/cn';
import { Input } from '@gideon-defender/ui/input';

interface DataTableRangeFilterProps<TData> extends React.ComponentProps<'div'> {
  filter: ExtendedColumnFilter<TData>;
  column: Column<TData>;
  inputId: string;
  onFilterUpdate: (
    filterId: string,
    updates: Partial<Omit<ExtendedColumnFilter<TData>, 'filterId'>>,
  ) => void;
}

export function DataTableRangeFilter<TData>({
  filter,
  column,
  inputId,
  onFilterUpdate,
  className,
  ...props
}: DataTableRangeFilterProps<TData>) {
  const locale = useLocale();
  const t = useTranslations('dataTable');
  const meta = column.columnDef.meta;

  const [min, max] = React.useMemo(() => {
    const range = column.columnDef.meta?.range;
    if (range) return range;

    const values = column.getFacetedMinMaxValues();
    if (!values) return [0, 100];

    return [values[0], values[1]];
  }, [column]);

  const formatValue = React.useCallback((value: string | number | undefined) => {
    if (value === undefined || value === '') return '';
    const numValue = Number(value);
    if (Number.isNaN(numValue)) return '';
    // `type="number"` inputs reject grouped digits ("1,234" / "1.234"),
    // so the input value stays ungrouped. Grouped display lives in the
    // placeholder below, which is display-only and never parsed.
    return String(numValue);
  }, []);

  const value = React.useMemo(() => {
    if (Array.isArray(filter.value)) return filter.value.map(formatValue);
    return [formatValue(filter.value), ''];
  }, [filter.value, formatValue]);

  const onRangeValueChange = React.useCallback(
    (value: string, isMin?: boolean) => {
      const numValue = Number(value);
      const currentValues = Array.isArray(filter.value) ? filter.value : ['', ''];
      const otherValue = isMin ? (currentValues[1] ?? '') : (currentValues[0] ?? '');

      if (
        value === '' ||
        (!Number.isNaN(numValue) &&
          (isMin
            ? numValue >= min && numValue <= (Number(otherValue) || max)
            : numValue <= max && numValue >= (Number(otherValue) || min)))
      ) {
        onFilterUpdate(filter.filterId, {
          value: isMin ? [value, otherValue] : [otherValue, value],
        });
      }
    },
    [filter.filterId, filter.value, min, max, onFilterUpdate],
  );

  return (
    <div data-slot="range" className={cn('flex w-full items-center gap-2', className)} {...props}>
      <Input
        id={`${inputId}-min`}
        type="number"
        aria-label={t('rangeMin', { label: meta?.label ?? column.id })}
        aria-valuemin={min}
        aria-valuemax={max}
        data-slot="range-min"
        inputMode="numeric"
        placeholder={min.toLocaleString(locale)}
        min={min}
        max={max}
        className="h-8 w-full rounded-sm"
        defaultValue={value[0]}
        onChange={(event) => onRangeValueChange(event.target.value, true)}
      />
      <Input
        id={`${inputId}-max`}
        type="number"
        aria-label={t('rangeMax', { label: meta?.label ?? column.id })}
        aria-valuemin={min}
        aria-valuemax={max}
        data-slot="range-max"
        inputMode="numeric"
        placeholder={max.toLocaleString(locale)}
        min={min}
        max={max}
        className="h-8 w-full rounded-sm"
        defaultValue={value[1]}
        onChange={(event) => onRangeValueChange(event.target.value)}
      />
    </div>
  );
}
