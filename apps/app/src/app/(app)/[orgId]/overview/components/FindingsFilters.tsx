'use client';
import { FindingSeverity, FindingStatus, FindingType } from '@db';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@gideon-defender/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gideon-defender/ui/select';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface Props {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  statusFilter: FindingStatus | 'all';
  onStatusChange: (value: FindingStatus | 'all') => void;
  severityFilter: FindingSeverity | 'all';
  onSeverityChange: (value: FindingSeverity | 'all') => void;
  frameworkFilter: FindingType | 'all';
  onFrameworkChange: (value: FindingType | 'all') => void;
  statusOptions: { value: FindingStatus | 'all'; label: string }[];
  severityOptions: { value: FindingSeverity | 'all'; label: string }[];
  frameworkOptions: { value: FindingType | 'all'; label: string }[];
}
export function FindingsFilters({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusChange,
  severityFilter,
  onSeverityChange,
  frameworkFilter,
  onFrameworkChange,
  statusOptions,
  severityOptions,
  frameworkOptions,
}: Props) {
  const t = useTranslations('overview');
  const statusLabel = statusOptions.find((o) => o.value === statusFilter)?.label;
  const severityLabel = severityOptions.find((o) => o.value === severityFilter)?.label;
  const frameworkLabel = frameworkOptions.find((o) => o.value === frameworkFilter)?.label;
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end">
      <div className="w-full md:max-w-[300px]">
        <InputGroup>
          <InputGroupAddon>
            <Search size={16} />
          </InputGroupAddon>
          <InputGroupInput
            placeholder={t('findings.searchFindings')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </InputGroup>
      </div>
      <div className="flex gap-2">
        <div className="flex-1 md:w-[180px] md:flex-none">
          <Select
            value={statusFilter}
            onValueChange={(v) => onStatusChange((v ?? 'all') as FindingStatus | 'all')}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('common.status')}>{statusLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 md:w-[180px] md:flex-none">
          <Select
            value={severityFilter}
            onValueChange={(v) => onSeverityChange((v ?? 'all') as FindingSeverity | 'all')}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('findings.severity')}>{severityLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {severityOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 md:w-[180px] md:flex-none">
          <Select
            value={frameworkFilter}
            onValueChange={(v) => onFrameworkChange((v ?? 'all') as FindingType | 'all')}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('findings.framework')}>{frameworkLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {frameworkOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
