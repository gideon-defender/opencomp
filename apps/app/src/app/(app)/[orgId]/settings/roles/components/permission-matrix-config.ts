import { statement } from '@gideon-defender/auth';
import type { useTranslations } from 'next-intl';

/** Access toggles — binary on/off permissions shown as switches above the matrix */
export const ACCESS_TOGGLE_KEYS = ['app'] as const;

/** Obligation toggles — requirements the role must fulfill, separate from permissions */
export const OBLIGATION_TOGGLE_KEYS = ['compliance'] as const;

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
export const RESOURCES = RESOURCE_KEYS.filter((key) => key in statement).map((key) => ({ key }));

/** Resources grouped into sections, filtered to only those present in the auth statement. */
export const RESOURCE_SECTIONS_RESOLVED = RESOURCE_SECTIONS.map((section) => ({
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
export type AccessLevel = 'none' | 'view' | 'edit';

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

/**
 * Determines the access level from the actual permissions array
 */
export function getAccessLevel(resourceKey: ResourceKey, permissions: string[]): AccessLevel {
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
export function accessLevelToPermissions(resourceKey: ResourceKey, level: AccessLevel): string[] {
  if (level === 'none') {
    return [];
  }
  return ACCESS_LEVEL_MAPPING[resourceKey][level];
}

type Translator = ReturnType<typeof useTranslations<'settings.roles'>>;

export function resourceLabel(t: Translator, key: string): string {
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

export function resourceDescription(t: Translator, key: string): string {
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

export function toggleLabel(t: Translator, key: string): string {
  switch (key) {
    case 'app':
      return t('matrix.appAccess');
    case 'compliance':
      return t('matrix.employeeCompliance');
    default:
      return key;
  }
}

export function toggleDescription(t: Translator, key: string): string {
  switch (key) {
    case 'app':
      return t('matrix.appAccessDescription');
    case 'compliance':
      return t('matrix.employeeComplianceDescription');
    default:
      return key;
  }
}

export function sectionTitle(t: Translator, id: 'compliance' | 'security'): string {
  switch (id) {
    case 'compliance':
      return t('matrix.sectionCompliance');
    case 'security':
      return t('matrix.sectionSecurity');
    default:
      return id;
  }
}
