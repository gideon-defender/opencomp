import type { NavMessageKey } from '@/i18n/keys';
import { Icons } from '@gideon-defender/ui/icons';
import {
  ClipboardCheck,
  FileTextIcon,
  FlaskConical,
  Gauge,
  ListCheck,
  NotebookText,
  ShieldCheck,
  ShieldEllipsis,
  Store,
  Users,
  Zap,
} from 'lucide-react';

export type MenuItem = {
  id: string;
  path: string;
  nameKey: NavMessageKey;
  disabled: boolean;
  icon: React.FC<{ size?: number }>;
  protected: boolean;
  badge?: {
    text: string;
    variant: 'default' | 'secondary' | 'outline' | 'destructive';
  };
  hidden?: boolean;
};

export function getMainMenuItems({
  canAccessAuditorView,
  isAdvancedModeEnabled,
  isQuestionnaireEnabled,
  isOnlyAuditor,
}: {
  canAccessAuditorView: boolean;
  isAdvancedModeEnabled: boolean;
  isQuestionnaireEnabled: boolean;
  isOnlyAuditor: boolean;
}): MenuItem[] {
  return [
    {
      id: 'overview',
      path: '/:organizationId/overview',
      nameKey: 'overview',
      disabled: false,
      icon: Gauge,
      protected: false,
    },
    {
      id: 'frameworks',
      path: '/:organizationId/frameworks',
      nameKey: 'frameworks',
      disabled: false,
      icon: Gauge,
      protected: false,
    },
    {
      id: 'auditor',
      path: '/:organizationId/auditor',
      nameKey: 'auditorView',
      disabled: false,
      icon: ClipboardCheck,
      protected: false,
      hidden: !canAccessAuditorView,
    },
    {
      id: 'controls',
      path: '/:organizationId/controls',
      nameKey: 'controls',
      disabled: false,
      icon: ShieldEllipsis,
      protected: false,
      hidden: !isAdvancedModeEnabled,
    },
    {
      id: 'policies',
      path: '/:organizationId/policies',
      nameKey: 'policies',
      disabled: false,
      icon: NotebookText,
      protected: false,
    },
    {
      id: 'tasks',
      path: '/:organizationId/tasks',
      nameKey: 'evidence',
      disabled: false,
      icon: ListCheck,
      protected: false,
    },
    {
      id: 'trust',
      path: '/:organizationId/trust',
      nameKey: 'trust',
      disabled: false,
      icon: ShieldCheck,
      protected: false,
    },
    {
      id: 'people',
      path: '/:organizationId/people/all',
      nameKey: 'people',
      disabled: false,
      icon: Users,
      protected: false,
    },
    {
      id: 'risk',
      path: '/:organizationId/risk',
      nameKey: 'risks',
      disabled: false,
      icon: Icons.Risk,
      protected: false,
    },
    {
      id: 'vendors',
      path: '/:organizationId/vendors',
      nameKey: 'vendors',
      disabled: false,
      icon: Store,
      protected: false,
    },
    {
      id: 'questionnaire',
      path: '/:organizationId/questionnaire',
      nameKey: 'questionnaire',
      disabled: false,
      icon: FileTextIcon,
      protected: false,
      hidden: !isQuestionnaireEnabled,
    },
    {
      id: 'integrations',
      path: '/:organizationId/integrations',
      nameKey: 'integrations',
      disabled: false,
      icon: Zap,
      protected: false,
      hidden: isOnlyAuditor,
    },
    {
      id: 'tests',
      path: '/:organizationId/cloud-tests',
      nameKey: 'cloudTests',
      disabled: false,
      icon: FlaskConical,
      protected: false,
    },
    {
      id: 'settings',
      path: '/:organizationId/settings',
      nameKey: 'settings',
      disabled: false,
      icon: Icons.Settings,
      protected: true,
      hidden: isOnlyAuditor,
    },
  ];
}
