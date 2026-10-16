'use client';

import { statement } from '@gideon-defender/auth';
import { RadioGroup, RadioGroupItem } from '@gideon-defender/ui/radio-group';
import { useTranslations } from 'next-intl';
import { AccessToggle, PermissionRow } from './PermissionMatrixControls';
import {
  ACCESS_TOGGLE_KEYS,
  accessLevelToPermissions,
  getAccessLevel,
  OBLIGATION_TOGGLE_KEYS,
  RESOURCE_SECTIONS_RESOLVED,
  sectionTitle,
  type AccessLevel,
} from './permission-matrix-config';

interface PermissionMatrixProps {
  value: Record<string, string[]>;
  allowedPermissions?: Record<string, string[]>;
  onChange: (permissions: Record<string, string[]>) => void;
  obligations?: Record<string, boolean>;
  onObligationsChange?: (obligations: Record<string, boolean>) => void;
  /** Disables the whole matrix. */
  disabled?: boolean;
  /**
   * When true, keeps the permission matrix and access toggles disabled but
   * leaves the obligation toggles editable. Used on built-in role pages so
   * customers can opt in/out of the compliance obligation without being able
   * to edit the role's permissions.
   */
  obligationsEditable?: boolean;
}

export function PermissionMatrix({
  value,
  allowedPermissions,
  onChange,
  obligations,
  onObligationsChange,
  disabled = false,
  obligationsEditable = false,
}: PermissionMatrixProps) {
  const t = useTranslations('settings.roles');
  const canGrant = ({ resource, actions }: { resource: string; actions: readonly string[] }) =>
    allowedPermissions === undefined ||
    actions.every((action) => allowedPermissions[resource]?.includes(action));
  const grantableActions = ({ resource, actions }: { resource: string; actions: string[] }) =>
    allowedPermissions === undefined
      ? actions
      : actions.filter((action) => allowedPermissions[resource]?.includes(action));
  const actionsForLevel = ({ resource, level }: { resource: string; level: AccessLevel }) =>
    grantableActions({ resource, actions: accessLevelToPermissions(resource, level) });
  const obligationsDisabled =
    (disabled && !obligationsEditable) ||
    !canGrant({ resource: 'portal', actions: statement.portal });
  const handleObligationChange = (key: string, enabled: boolean) => {
    if (!onObligationsChange || obligationsDisabled) return;
    const newObligations = { ...obligations };
    if (enabled) {
      newObligations[key] = true;
    } else {
      delete newObligations[key];
    }
    onObligationsChange(newObligations);

    // Compliance requires the full portal set; disable opt-in when the caller lacks it.
    if (key === 'compliance' && enabled) {
      onChange({ ...value, portal: [...statement.portal] });
    }
  };

  const handleToggleChange = (resourceKey: string, enabled: boolean) => {
    const newPermissions = { ...value };
    if (enabled) {
      // app only has 'read', trust has 'read' and 'update'
      const actions = statement[resourceKey as keyof typeof statement];
      newPermissions[resourceKey] = grantableActions({
        resource: resourceKey,
        actions: actions ? [...actions] : ['read'],
      });
    } else {
      delete newPermissions[resourceKey];
    }
    onChange(newPermissions);
  };

  const handleAccessChange = (resourceKey: string, level: AccessLevel) => {
    const newPermissions = { ...value };
    const permissions = actionsForLevel({ resource: resourceKey, level });

    if (permissions.length === 0) {
      delete newPermissions[resourceKey];
    } else {
      newPermissions[resourceKey] = permissions;
    }

    onChange(newPermissions);
  };

  const handleSetAllInSection = (sectionResources: Array<{ key: string }>, level: AccessLevel) => {
    if (disabled) return;
    const newPermissions = { ...value };
    for (const resource of sectionResources) {
      const permissions = actionsForLevel({ resource: resource.key, level });
      if (permissions.length === 0) {
        delete newPermissions[resource.key];
      } else {
        newPermissions[resource.key] = permissions;
      }
    }
    onChange(newPermissions);
  };

  const getSectionAccessLevel = (
    sectionResources: Array<{ key: string }>,
  ): AccessLevel | 'mixed' => {
    if (sectionResources.length === 0) return 'none';
    const levels = sectionResources.map((r) => getAccessLevel(r.key, value[r.key] || []));
    const first = levels[0];
    return levels.every((l) => l === first) ? first : 'mixed';
  };

  return (
    <div className="space-y-4">
      {/* Access Toggles */}
      <div className="rounded-md border">
        <div className="border-b bg-muted/50 py-2 px-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('matrix.access')}
          </span>
        </div>
        {ACCESS_TOGGLE_KEYS.map((toggleKey) => (
          <AccessToggle
            key={toggleKey}
            toggleKey={toggleKey}
            enabled={Boolean(value[toggleKey]?.length)}
            onToggle={(enabled) => handleToggleChange(toggleKey, enabled)}
            disabled={disabled || !canGrant({ resource: toggleKey, actions: ['read'] })}
          />
        ))}
      </div>

      {/* Obligations */}
      <div className="rounded-md border">
        <div className="border-b bg-muted/50 py-2 px-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('matrix.obligations')}
          </span>
        </div>
        {OBLIGATION_TOGGLE_KEYS.map((toggleKey) => (
          <AccessToggle
            key={toggleKey}
            toggleKey={toggleKey}
            enabled={Boolean(obligations?.[toggleKey])}
            onToggle={(enabled) => handleObligationChange(toggleKey, enabled)}
            disabled={obligationsDisabled}
          />
        ))}
      </div>

      {/* Resource Permissions Matrix */}
      {RESOURCE_SECTIONS_RESOLVED.map((section) => (
        <div key={section.id} className="rounded-md border">
          {/* Section + Column Header */}
          <div className="grid grid-cols-[minmax(0,1fr)_3rem_3rem_3rem] sm:grid-cols-[minmax(0,1fr)_6rem_6rem_6rem] items-center border-b bg-muted/50 py-2 px-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {sectionTitle(t, section.id)}
            </span>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-center">
              {t('matrix.noAccess')}
            </span>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-center">
              {t('matrix.read')}
            </span>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-center">
              {t('matrix.write')}
            </span>
          </div>
          {/* Select All Row */}
          {section.resources.length > 1 &&
            (() => {
              const sectionLevel = getSectionAccessLevel(section.resources);
              return (
                <RadioGroup
                  aria-label={t('matrix.selectAll')}
                  aria-disabled={disabled}
                  value={sectionLevel === 'mixed' ? '' : sectionLevel}
                  onValueChange={(newValue) => {
                    if (newValue === 'none' || newValue === 'view' || newValue === 'edit')
                      handleSetAllInSection(section.resources, newValue);
                  }}
                  disabled={disabled}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_3rem_3rem_3rem] sm:grid-cols-[minmax(0,1fr)_6rem_6rem_6rem] items-center border-b py-3 px-3 bg-muted/25">
                    <div>
                      <span className="text-sm font-medium">{t('matrix.selectAll')}</span>
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
                      />
                    </div>
                    <div className="flex justify-center">
                      <RadioGroupItem
                        data-slot="radio-group-item"
                        value="edit"
                        aria-label={t('matrix.write')}
                      />
                    </div>
                  </div>
                </RadioGroup>
              );
            })()}
          {/* Rows */}
          {section.resources.map((resource) => {
            const currentLevel = getAccessLevel(resource.key, value[resource.key] || []);

            return (
              <PermissionRow
                key={resource.key}
                resource={resource}
                currentLevel={currentLevel}
                onAccessChange={(level) => handleAccessChange(resource.key, level)}
                disabled={disabled}
                canRead={canGrant({ resource: resource.key, actions: ['read'] })}
                canWrite={actionsForLevel({ resource: resource.key, level: 'edit' }).some(
                  (action) => action !== 'read',
                )}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Export utilities for use in other components
export { accessLevelToPermissions, getAccessLevel, RESOURCES } from './permission-matrix-config';
