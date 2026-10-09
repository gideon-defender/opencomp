'use client';

import { useIntegrationMutations } from '@/hooks/use-integration-platform';
import { usePermissions } from '@/hooks/use-permissions';
import { Button } from '@gideon-defender/ui/button';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

export function OAuthReconnect({
  connectionId,
  providerSlug,
  providerName,
  errorMessage,
}: {
  connectionId: string;
  providerSlug: string;
  providerName: string;
  errorMessage?: string | null;
}) {
  const { startOAuth } = useIntegrationMutations();
  const { hasPermission } = usePermissions();
  const [connecting, setConnecting] = useState(false);
  const canReconnect =
    hasPermission('integration', 'create') && hasPermission('integration', 'update');
  const label = providerSlug === 'gcp' ? 'Google' : providerName;

  const handleReconnect = async () => {
    if (!canReconnect || connecting) return;
    setConnecting(true);
    try {
      const result = await startOAuth(providerSlug, window.location.href, connectionId);
      if (!result.success || !result.authorizationUrl) {
        toast.error(result.error || 'Failed to start authorization');
        setConnecting(false);
        return;
      }
      window.location.assign(result.authorizationUrl);
    } catch {
      toast.error('Failed to start authorization');
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <p className="text-sm font-medium">Authorize this connection again</p>
      <p className="text-sm text-muted-foreground">
        {errorMessage ||
          `Sign in to ${label} to authorize again. Saved findings and scan history are preserved.`}
      </p>
      {canReconnect && (
        <Button onClick={handleReconnect} disabled={connecting}>
          {connecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {connecting ? 'Connecting...' : `Reconnect with ${label}`}
        </Button>
      )}
    </div>
  );
}
