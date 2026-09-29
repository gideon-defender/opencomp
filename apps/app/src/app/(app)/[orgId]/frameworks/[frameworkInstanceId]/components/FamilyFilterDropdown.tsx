'use client';

import { Button } from '@trycompai/design-system';
import { Checkbox, CheckboxCheckedFilled, Close, Filter } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { getFamilyDisplayLabel } from './framework-controls-shared';

interface FamilyFilterDropdownProps {
  allFamilyNames: string[];
  familyCounts: Map<string, number>;
  selectedFamilies: Set<string>;
  onToggleFamily: (family: string) => void;
  onClear: () => void;
}

export function FamilyFilterDropdown({
  allFamilyNames,
  familyCounts,
  selectedFamilies,
  onToggleFamily,
  onClear,
}: FamilyFilterDropdownProps) {
  const t = useTranslations('frameworks');
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const [prevDropdownOpen, setPrevDropdownOpen] = useState(open);
  if (prevDropdownOpen !== open) {
    setPrevDropdownOpen(open);
    if (!open) setSearchTerm('');
  }

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const hasFilter = selectedFamilies.size > 0;
  const label = hasFilter
    ? t('instance.familiesSelected', { count: selectedFamilies.size })
    : t('instance.families');

  const filteredFamilies = allFamilyNames.filter((f) =>
    getFamilyDisplayLabel(f, t).toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1">
        <Button variant="outline" onClick={() => setOpen((prev) => !prev)}>
          <Filter size={16} />
          {label}
        </Button>
        {hasFilter && (
          <button
            type="button"
            className="flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground"
            onClick={onClear}
          >
            <Close size={14} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border bg-background shadow-lg">
          <input
            type="text"
            placeholder={t('instance.searchFamiliesPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full border-b border-border bg-transparent px-3 py-1.5 text-sm outline-none"
            autoFocus
          />
          <div className="max-h-64 overflow-y-auto p-1">
            {filteredFamilies.map((family) => {
              const isSelected = selectedFamilies.has(family);
              const Icon = isSelected ? CheckboxCheckedFilled : Checkbox;

              return (
                <button
                  key={family}
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted cursor-pointer"
                  onClick={() => onToggleFamily(family)}
                >
                  <Icon
                    size={16}
                    className={isSelected ? 'text-primary' : 'text-muted-foreground'}
                  />
                  <span className="flex-1 truncate text-sm">
                    {getFamilyDisplayLabel(family, t)}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {familyCounts.get(family) ?? 0}
                  </span>
                </button>
              );
            })}
            {filteredFamilies.length === 0 && (
              <p className="text-muted-foreground py-3 text-center text-xs">
                {t('instance.noMatchingFamilies')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
