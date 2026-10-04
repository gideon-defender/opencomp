import type { FrameworkEditorFrameworkFamilyStatus } from '@/db';
import { useTranslations } from 'next-intl';

// FRAME-20: the four family statuses, in the order shown in the dropdown.
export const FRAMEWORK_FAMILY_STATUSES: {
  value: FrameworkEditorFrameworkFamilyStatus;
  label: string;
}[] = [
  { value: 'visible', label: 'Visible' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'under_construction', label: 'Under Construction' },
  { value: 'partial', label: 'Partial' },
];

// Color rules per the ticket: visible=green/white, hidden=black, under
// construction=red, partial=amber.
const STATUS_STYLES: Record<FrameworkEditorFrameworkFamilyStatus, string> = {
  visible: 'bg-green-600 text-white',
  hidden: 'bg-black text-white',
  under_construction: 'bg-red-600 text-white',
  partial: 'bg-amber-500 text-black',
};

const STATUS_LABELS: Record<FrameworkEditorFrameworkFamilyStatus, string> = {
  visible: 'Visible',
  hidden: 'Hidden',
  under_construction: 'Under Construction',
  partial: 'Partial',
};

/** Human label for a family status (e.g. 'under_construction' → 'Under Construction'). */
export function getFamilyStatusLabel(status: FrameworkEditorFrameworkFamilyStatus): string {
  return STATUS_LABELS[status];
}

/** Tailwind background/text classes for a family status badge. */
export function getFamilyStatusClassName(status: FrameworkEditorFrameworkFamilyStatus): string {
  return STATUS_STYLES[status];
}

export function FamilyStatusBadge({ status }: { status: FrameworkEditorFrameworkFamilyStatus }) {
  const t = useTranslations('frameworks');

  if (status === 'visible')
    return <StatusBadge className={getFamilyStatusClassName(status)} label={t('status.visible')} />;
  if (status === 'hidden')
    return <StatusBadge className={getFamilyStatusClassName(status)} label={t('status.hidden')} />;
  if (status === 'partial')
    return <StatusBadge className={getFamilyStatusClassName(status)} label={t('status.partial')} />;
  return (
    <StatusBadge
      className={getFamilyStatusClassName(status)}
      label={t('status.underConstruction')}
    />
  );
}

function StatusBadge({ className, label }: { className: string; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

/** A framework's own visibility, rendered with the same green/black palette. */
export function FrameworkVisibilityBadge({ visible }: { visible: boolean }) {
  return <FamilyStatusBadge status={visible ? 'visible' : 'hidden'} />;
}
