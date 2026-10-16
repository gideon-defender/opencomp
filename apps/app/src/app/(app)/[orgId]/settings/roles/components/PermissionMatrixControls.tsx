'use client';

import { RadioGroup, RadioGroupItem } from '@gideon-defender/ui/radio-group';
import { Switch } from '@gideon-defender/ui/switch';
import { useTranslations } from 'next-intl';
import {
  type AccessLevel,
  resourceDescription,
  resourceLabel,
  toggleDescription,
  toggleLabel,
} from './permission-matrix-config';

export function PermissionRow({
  resource,
  currentLevel,
  onAccessChange,
  disabled,
  canRead = true,
  canWrite = true,
}: {
  resource: { key: string };
  canRead?: boolean;
  canWrite?: boolean;
  currentLevel: AccessLevel;
  onAccessChange: (level: AccessLevel) => void;
  disabled: boolean;
}) {
  const t = useTranslations('settings.roles');
  return (
    <RadioGroup
      aria-label={resourceLabel(t, resource.key)}
      aria-disabled={disabled}
      value={currentLevel}
      onValueChange={(newValue) => {
        if (newValue === 'none' || newValue === 'view' || newValue === 'edit')
          onAccessChange(newValue);
      }}
      disabled={disabled}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_3rem_3rem_3rem] sm:grid-cols-[minmax(0,1fr)_6rem_6rem_6rem] items-center border-b last:border-b-0 py-3 px-3">
        <div>
          <p className="text-sm font-medium">{resourceLabel(t, resource.key)}</p>
          <p className="text-xs text-muted-foreground">{resourceDescription(t, resource.key)}</p>
        </div>
        <div className="flex justify-center">
          <RadioGroupItem
            data-slot="radio-group-item"
            value="none"
            aria-label={t('matrix.noAccess')}
          />
        </div>
        <div className="flex justify-center">
          <RadioGroupItem
            data-slot="radio-group-item"
            value="view"
            aria-label={t('matrix.read')}
            disabled={!canRead}
          />
        </div>
        <div className="flex justify-center">
          <RadioGroupItem
            data-slot="radio-group-item"
            value="edit"
            aria-label={t('matrix.write')}
            disabled={!canWrite}
          />
        </div>
      </div>
    </RadioGroup>
  );
}

export function AccessToggle({
  toggleKey,
  enabled,
  onToggle,
  disabled,
}: {
  toggleKey: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  disabled: boolean;
}) {
  const t = useTranslations('settings.roles');
  return (
    <div className="flex items-center justify-between py-3 px-3 border-b last:border-b-0">
      <div>
        <p className="text-sm font-medium">{toggleLabel(t, toggleKey)}</p>
        <p className="text-xs text-muted-foreground">{toggleDescription(t, toggleKey)}</p>
      </div>
      <Switch
        aria-label={toggleLabel(t, toggleKey)}
        checked={enabled}
        onCheckedChange={onToggle}
        disabled={disabled}
      />
    </div>
  );
}
