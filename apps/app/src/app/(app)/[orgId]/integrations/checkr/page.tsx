import { serverApi } from '@/lib/api-server';
import { hasPermission } from '@/lib/permissions';
import { resolveCurrentUserPermissions } from '@/lib/permissions.server';
import type { Metadata } from 'next';
import type { CandidateScreeningsResponse } from '../../people/components/CandidateScreenings';
import type { CheckrReadiness } from '../components/CheckrCatalogCard';
import { CheckrDetailsClient } from './components/CheckrDetailsClient';

interface PageProps {
  params: Promise<{ orgId: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Checkr Integration' };
}

export default async function CheckrIntegrationPage({ params }: PageProps) {
  const { orgId } = await params;

  // The integrations layout already requires integration:read.
  const permissions = await resolveCurrentUserPermissions(orgId);
  const canReadScreenings = !!permissions && hasPermission(permissions, 'backgroundCheck', 'read');
  const canStartScreening =
    !!permissions && hasPermission(permissions, 'backgroundCheck', 'create');
  const canManageIntegration = !!permissions && hasPermission(permissions, 'integration', 'update');
  const canConfigureCheckr =
    canManageIntegration &&
    !!permissions &&
    hasPermission(permissions, 'secret', 'create') &&
    hasPermission(permissions, 'secret', 'delete');
  const canReadReadiness = canStartScreening || canManageIntegration;
  const readinessEndpoint = canStartScreening
    ? '/v1/people/candidate-screenings/readiness'
    : '/v1/people/candidate-screenings/connection/readiness';

  const tenantHeaders = { 'X-Organization-Id': orgId };
  const [screeningsRes, readinessRes] = await Promise.all([
    canReadScreenings
      ? serverApi.get<CandidateScreeningsResponse>('/v1/people/candidate-screenings', tenantHeaders)
      : Promise.resolve(null),
    canReadReadiness
      ? serverApi.get<CheckrReadiness>(readinessEndpoint, tenantHeaders)
      : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Checkr</h1>
      <CheckrDetailsClient
        orgId={orgId}
        canStartScreening={canStartScreening}
        canReadScreenings={canReadScreenings}
        canConfigureCheckr={canConfigureCheckr}
        canReadReadiness={canReadReadiness}
        initialScreenings={screeningsRes?.data ?? undefined}
        initialReadiness={readinessRes?.data ?? undefined}
      />
    </div>
  );
}
