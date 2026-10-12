'use client';

import { usePermissions } from '@/hooks/use-permissions';
import { Alert, AlertDescription, AlertTitle } from '@gideon-defender/ui/alert';
import { Button } from '@gideon-defender/ui/button';
import { ArrowRight, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { NudgeState, ServerNudgeData } from './types';

export function useTrustPortalSetupNudge({
  orgId,
  server,
}: {
  orgId: string;
  server: ServerNudgeData;
}): NudgeState {
  const { hasPermission } = usePermissions();
  const canSetup = hasPermission('trust', 'update');
  const { isConfigured } = server.trust;

  return {
    id: 'trust-portal-setup',
    priority: 20,
    persistDismissal: true,
    ready: true, // server data already resolved
    eligible: !isConfigured && canSetup,
    render: (onDismiss) => <TrustPortalSetupNudgeView orgId={orgId} onDismiss={onDismiss} />,
  };
}

function TrustPortalSetupNudgeView({ orgId, onDismiss }: { orgId: string; onDismiss: () => void }) {
  const t = useTranslations('overview');
  return (
    <Alert className="border-warning/30 bg-warning/5">
      <AlertTitle>
        <span className="text-foreground">{t('nudges.trustSetupTitle')}</span>
      </AlertTitle>
      <AlertDescription>
        <span className="text-foreground">{t('nudges.trustSetupBody')}</span>
      </AlertDescription>
      <div className="col-start-2 pt-1">
        <Button asChild>
          <Link href={`/${orgId}/trust`}>
            {t('nudges.trustSetupAction')}
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
      <div className="absolute right-2 top-2">
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('common.dismiss')}
          className="rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
        >
          <X size={16} />
        </button>
      </div>
    </Alert>
  );
}
