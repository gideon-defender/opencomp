'use client';

import { OAuthReconnect } from '@/components/integrations/OAuthReconnect';
import { useIntegrationConnections } from '@/hooks/use-integration-platform';

export function CloudConnectionRecovery({ connectionId }: { connectionId: string }) {
  const { connections } = useIntegrationConnections();
  const connection = connections.find((item) => item.id === connectionId);
  if (!connection || connection.status !== 'error') return null;
  if (connection.authStrategy !== 'oauth2') {
    return (
      <p role="alert" className="rounded-lg border p-4 text-sm text-destructive">
        {connection.errorMessage ||
          'Connection needs attention. Update its configuration in Integrations.'}
      </p>
    );
  }
  return (
    <OAuthReconnect
      connectionId={connection.id}
      providerSlug={connection.providerSlug}
      providerName={connection.providerName}
      errorMessage={connection.errorMessage}
    />
  );
}
