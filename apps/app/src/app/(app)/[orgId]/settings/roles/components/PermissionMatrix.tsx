'use client';

import { statement } from '@gideon-defender/auth';
import { RadioGroup, RadioGroupItem, Switch, Text } from '@trycompai/design-system';
import { useTranslations } from 'next-intl';

/** Access toggles — binary on/off permissions shown as switches above the matrix */
const ACCESS_TOGGLE_KEYS = ['app'] as const;

/** Obligation toggles — requirements the role must fulfill, separate from permissions */
const OBLIGATION_TOGGLE_KEYS = ['compliance'] as const;

/** UI-labeled permission resources. Keys kept in display order. */
const RESOURCE_KEYS = [
  'organization',
  'member',
  'control',
  'evidence',
  'policy',
  'risk',
  'vendor',
  'task',
  'framework',
  'audit',
  'finding',
  'questionnaire',
  'integration',
  'apiKey',
  'secret',
  'trust',
  'pentest',
] as const;

/** Resources grouped by product section for the permission matrix UI. */
const RESOURCE_SECTIONS: Array<{ id: 'compliance' | 'security'; keys: readonly string[] }> = [
  {
    id: 'compliance',
    keys: [
      'organization',
      'member',
      'control',
      'evidence',
      'policy',
      'risk',
      'vendor',
      'task',
      'framework',
      'audit',
      'finding',
      'questionnaire',
      'integration',
      'apiKey',
      'secret',
      'trust',
    ],
  },
  {
    id: 'security',
    keys: ['pentest'],
  },
];

/**
 * Resources available for permission assignment — derived from @gideon-defender/auth statement.
 * Only includes resources that have a UI label (excludes internal ones like 'ac', 'team', 'app').
 */
const RESOURCES = RESOURCE_KEYS.filter((key) => key in statement).map((key) => ({ key }));

/** Resources grouped into sections, filtered to only those present in the auth statement. */
const RESOURCE_SECTIONS_RESOLVED = RESOURCE_SECTIONS.map((section) => ({
  id: section.id,
  resources: section.keys.filter((key) => key in statement).map((key) => ({ key })),
})).filter((section) => section.resources.length > 0);

type ResourceKey = string;

/**
 * Access levels for the simplified permission model:
 * - none: No access to the resource
 * - view: Read-only access ('read')
 * - edit: Full access (all actions the resource supports)
 */
type AccessLevel = 'none' | 'view' | 'edit';

/**
 * Maps access levels to the actual permission actions for each resource.
 * Derived from the @gideon-defender/auth statement (single source of truth).
 * - view = ['read']
 * - edit = all actions the resource supports
 */
const ACCESS_LEVEL_MAPPING: Record<
  string,
  Record<Exclude<AccessLevel, 'none'>, string[]>
> = Object.fromEntries(
  Object.entries(statement)
    .filter(([key]) => (RESOURCE_KEYS as readonly string[]).includes(key))
    .map(([key, actions]) => [
      key,
      {
        view: ['read'],
        edit: [...actions],
      },
    ]),
);

interface PermissionMatrixProps {
  value: Record<string, string[]>;
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

/**
 * Determines the access level from the actual permissions array
 */
function getAccessLevel(resourceKey: ResourceKey, permissions: string[]): AccessLevel {
  if (!permissions || permissions.length === 0) {
    return 'none';
  }

  // Check if it has edit-level permissions (includes create, update, or delete)
  const hasEditPermissions = permissions.some(
    (p) => p === 'create' || p === 'update' || p === 'delete',
  );

  if (hasEditPermissions) {
    return 'edit';
  }

  // Check if it has at least read permission
  if (permissions.includes('read')) {
    return 'view';
  }

  return 'none';
}

/**
 * Converts access level to actual permission actions
 */
function accessLevelToPermissions(resourceKey: ResourceKey, level: AccessLevel): string[] {
  if (level === 'none') {
    return [];
  }
  return ACCESS_LEVEL_MAPPING[resourceKey][level];
}

type Translator = ReturnType<typeof useTranslations<'settings.roles'>>;

function resourceLabel(t: Translator, key: string): string {
  switch (key) {
    case 'organization':
      return t('matrix.organization');
    case 'member':
      return t('matrix.member');
    case 'control':
      return t('matrix.control');
    case 'evidence':
      return t('matrix.evidence');
    case 'policy':
      return t('matrix.policy');
    case 'risk':
      return t('matrix.risk');
    case 'vendor':
      return t('matrix.vendor');
    case 'task':
      return t('matrix.task');
    case 'framework':
      return t('matrix.framework');
    case 'audit':
      return t('matrix.audit');
    case 'finding':
      return t('matrix.finding');
    case 'questionnaire':
      return t('matrix.questionnaire');
    case 'integration':
      return t('matrix.integration');
    case 'apiKey':
      return t('matrix.apiKey');
    case 'secret':
      return t('matrix.secret');
    case 'trust':
      return t('matrix.trust');
    case 'pentest':
      return t('matrix.pentest');
    default:
      return key;
  }
}

function resourceDescription(t: Translator, key: string): string {
  switch (key) {
    case 'organization':
      return t('matrix.organizationDescription');
    case 'member':
      return t('matrix.memberDescription');
    case 'control':
      return t('matrix.controlDescription');
    case 'evidence':
      return t('matrix.evidenceDescription');
    case 'policy':
      return t('matrix.policyDescription');
    case 'risk':
      return t('matrix.riskDescription');
    case 'vendor':
      return t('matrix.vendorDescription');
    case 'task':
      return t('matrix.taskDescription');
    case 'framework':
      return t('matrix.frameworkDescription');
    case 'audit':
      return t('matrix.auditDescription');
    case 'finding':
      return t('matrix.findingDescription');
    case 'questionnaire':
      return t('matrix.questionnaireDescription');
    case 'integration':
      return t('matrix.integrationDescription');
    case 'apiKey':
      return t('matrix.apiKeyDescription');
    case 'secret':
      return t('matrix.secretDescription');
    case 'trust':
      return t('matrix.trustDescription');
    case 'pentest':
      return t('matrix.pentestDescription');
    default:
      return key;
  }
}

function toggleLabel(t: Translator, key: string): string {
  switch (key) {
    case 'app':
      return t('matrix.appAccess');
    case 'compliance':
      return t('matrix.employeeCompliance');
    default:
      return key;
  }
}

function toggleDescription(t: Translator, key: string): string {
  switch (key) {
    case 'app':
      return t('matrix.appAccessDescription');
    case 'compliance':
      return t('matrix.employeeComplianceDescription');
    default:
      return key;
  }
}

function sectionTitle(t: Translator, id: 'compliance' | 'security'): string {
  switch (id) {
    case 'compliance':
      return t('matrix.sectionCompliance');
    case 'security':
      return t('matrix.sectionSecurity');
    default:
      return id;
  }
}

function PermissionRow({
  resource,
  currentLevel,
  onAccessChange,
  disabled,
}: {
  resource: { key: string };
  currentLevel: AccessLevel;
  onAccessChange: (level: AccessLevel) => void;
  disabled: boolean;
}) {
  const t = useTranslations('settings.roles');
  return (
    <RadioGroup
      value={currentLevel}
      onValueChange={(newValue) => onAccessChange(newValue as AccessLevel)}
      disabled={disabled}
    >
      <div className="grid grid-cols-[1fr_100px_100px_100px] items-center border-b last:border-b-0 py-3 px-3">
        <div>
          <Text size="sm" weight="medium">
            {resourceLabel(t, resource.key)}
          </Text>
          <Text size="xs" variant="muted">
            {resourceDescription(t, resource.key)}
          </Text>
        </div>
        <div className="flex justify-center">
          <RadioGroupItem value="none" />
        </div>
        <div className="flex justify-center">
          <RadioGroupItem value="view" />
        </div>
        <div className="flex justify-center">
          <RadioGroupItem value="edit" />
        </div>
      </div>
    </RadioGroup>
  );
}

function AccessToggle({
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
        <Text size="sm" weight="medium">
          {toggleLabel(t, toggleKey)}
        </Text>
        <Text size="xs" variant="muted">
          {toggleDescription(t, toggleKey)}
        </Text>
      </div>
      <Switch checked={enabled} onCheckedChange={onToggle} disabled={disabled} />
    </div>
  );
}

export function PermissionMatrix({
  value,
  onChange,
  obligations,
  onObligationsChange,
  disabled = false,
  obligationsEditable = false,
}: PermissionMatrixProps) {
  const t = useTranslations('settings.roles');
  const obligationsDisabled = disabled && !obligationsEditable;
  const handleObligationChange = (key: string, enabled: boolean) => {
    if (!onObligationsChange) return;
    const newObligations = { ...obligations };
    if (enabled) {
      newObligations[key] = true;
    } else {
      delete newObligations[key];
    }
    onObligationsChange(newObligations);

    // The 'compliance' obligation (Employee Compliance) implies portal
    // self-service access (sign policies, watch training, etc.) — there's
    // no separate matrix row for the 'portal' resource itself (it's
    // excluded from RESOURCE_LABELS/RESOURCE_SECTIONS), so grant it here
    // when the obligation is enabled. This is intentionally one-directional:
    // disabling the obligation must NOT strip 'portal' back off, since a
    // role can also hold portal access independently of this obligation
    // (e.g. granted directly through the API) — the UI has no separate row
    // for 'portal' to tell those cases apart, so it must never revoke an
    // access grant it didn't itself create.
    if (key === 'compliance' && enabled) {
      onChange({ ...value, portal: [...statement.portal] });
    }
  };

  const handleToggleChange = (resourceKey: string, enabled: boolean) => {
    const newPermissions = { ...value };
    if (enabled) {
      // app only has 'read', trust has 'read' and 'update'
      const actions = statement[resourceKey as keyof typeof statement];
      newPermissions[resourceKey] = actions ? [...actions] : ['read'];
    } else {
      delete newPermissions[resourceKey];
    }
    onChange(newPermissions);
  };

  const handleAccessChange = (resourceKey: ResourceKey, level: AccessLevel) => {
    const newPermissions = { ...value };
    const permissions = accessLevelToPermissions(resourceKey, level);

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
      const permissions = accessLevelToPermissions(resource.key, level);
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
            disabled={disabled}
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
          <div className="grid grid-cols-[1fr_100px_100px_100px] items-center border-b bg-muted/50 py-2 px-3">
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
                  value={sectionLevel === 'mixed' ? '' : sectionLevel}
                  onValueChange={(newValue) =>
                    handleSetAllInSection(section.resources, newValue as AccessLevel)
                  }
                  disabled={disabled}
                >
                  <div className="grid grid-cols-[1fr_100px_100px_100px] items-center border-b py-3 px-3 bg-muted/25">
                    <div>
                      <Text size="sm" weight="medium">
                        {t('matrix.selectAll')}
                      </Text>
                    </div>
                    <div className="flex justify-center">
                      <RadioGroupItem value="none" />
                    </div>
                    <div className="flex justify-center">
                      <RadioGroupItem value="view" />
                    </div>
                    <div className="flex justify-center">
                      <RadioGroupItem value="edit" />
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
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Export utilities for use in other components
export { accessLevelToPermissions, getAccessLevel, RESOURCES };
