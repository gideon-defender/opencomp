'use client';

import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gideon-defender/ui';
import { Search as SearchIcon, SortAsc, SortDesc } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type React from 'react';
// Import types from the common types definition file
import type { SortDirection, SortableColumnOption } from '../types/common';

export interface TableToolbarProps {
  searchTerm: string;
  onSearchTermChange: (term: string) => void;
  sortColumnKey: string | null; // Generic string for the value of the sort column
  onSortColumnKeyChange: (key: string | null) => void;
  sortDirection: SortDirection;
  onSortDirectionChange: () => void; // Simplified: just toggles
  sortableColumnOptions: SortableColumnOption[];

  showCommitCancel?: boolean;
  isDirty?: boolean;
  onCommit?: () => void;
  onCancel?: () => void;
  commitButtonDetailText?: string;

  showCreateButton?: boolean;
  onCreateClick?: () => void;
  createButtonLabel?: string;
  children?: React.ReactNode; // For additional custom elements in the toolbar
}

export const TableToolbar: React.FC<TableToolbarProps> = ({
  searchTerm,
  onSearchTermChange,
  sortColumnKey,
  onSortColumnKeyChange,
  sortDirection,
  onSortDirectionChange,
  sortableColumnOptions,
  showCommitCancel = false,
  isDirty = false,
  onCommit,
  onCancel,
  commitButtonDetailText = '',
  children,
}) => {
  const t = useTranslations('toolbar');

  let commitButtonLabelText = t('noChanges');
  if (isDirty) {
    if (commitButtonDetailText && commitButtonDetailText.length > 0) {
      commitButtonLabelText = t('commitWithDetail', { detail: commitButtonDetailText });
    } else {
      // Fallback if isDirty is true but commitButtonDetailText is empty (e.g. hook logic yields empty for some reason)
      commitButtonLabelText = t('commitChanges');
    }
  }

  const directionLabel = sortDirection === 'asc' ? t('ascending') : t('descending');

  return (
    <div className="flex flex-col items-center gap-2 sm:flex-row">
      <Input
        type="text"
        placeholder={t('searchPlaceholder')}
        value={searchTerm}
        onChange={(e) => onSearchTermChange(e.target.value)}
        className="flex-grow sm:w-full sm:grow-0" // Adjust based on Input component needs
        leftIcon={<SearchIcon className="text-muted-foreground h-4 w-4" />}
      />
      <div className="flex items-center gap-2">
        <Select
          value={sortColumnKey ?? '__NONE__'}
          onValueChange={(value) => onSortColumnKeyChange(value === '__NONE__' ? null : value)}
        >
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder={t('sortBy')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__NONE__">{t('sortNone')}</SelectItem>
            {sortableColumnOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          onClick={onSortDirectionChange}
          disabled={!sortColumnKey}
          title={t('sortDirection', { direction: directionLabel })}
        >
          {sortDirection === 'asc' ? (
            <SortAsc className="h-4 w-4" />
          ) : (
            <SortDesc className="h-4 w-4" />
          )}
        </Button>
      </div>
      {showCommitCancel && (
        <>
          {isDirty && (
            <Button onClick={onCancel} disabled={!isDirty} variant="outline">
              {t('discardChanges')}
            </Button>
          )}
          <Button onClick={onCommit} disabled={!isDirty} variant="default">
            {commitButtonLabelText}
          </Button>
        </>
      )}
      {children} {/* For any additional elements passed from parent */}
    </div>
  );
};
