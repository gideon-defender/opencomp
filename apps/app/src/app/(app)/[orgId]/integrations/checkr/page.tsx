import { serverApi } from '@/lib/api-server';
import { hasPermission } from '@/lib/permissions';
import { resolveCurrentUserPermissions } from '@/lib/permissions.server';
import { PageHeader, PageLayout, Stack } from '@trycompai/design-system';
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
  // Screening lists need backgroundCheck:read; readiness needs backgroundCheck:create.
  const permissions = await resolveCurrentUserPermissions(orgId);
  const canReadScreenings = !!permissions && hasPermission(permissions, 'backgroundCheck', 'read');
  const canStartScreening =
    !!permissions && hasPermission(permissions, 'backgroundCheck', 'create');

  const tenantHeaders = { 'X-Organization-Id': orgId };
  const [screeningsRes, readinessRes] = await Promise.all([
    canReadScreenings
      ? serverApi.get<CandidateScreeningsResponse>('/v1/people/candidate-screenings', tenantHeaders)
      : Promise.resolve(null),
    canStartScreening
      ? serverApi.get<CheckrReadiness>('/v1/people/candidate-screenings/readiness', tenantHeaders)
      : Promise.resolve(null),
  ]);

  return (
    <PageLayout>
      <Stack gap="md">
        <PageHeader title="Checkr" />
        <CheckrDetailsClient
          orgId={orgId}
          canStartScreening={canStartScreening}
          canReadScreenings={canReadScreenings}
          initialScreenings={screeningsRes?.data ?? undefined}
          initialReadiness={readinessRes?.data ?? undefined}
        />
      </Stack>
    </PageLayout>
  );
}
