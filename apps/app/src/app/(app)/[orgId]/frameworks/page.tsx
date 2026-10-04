import { serverApi } from '@/lib/api-server';
import type { FrameworkInstanceWithControls } from '@/lib/types/framework';
import type { FrameworkEditorFramework } from '@db';
import { PageHeader, PageLayout } from '@trycompai/design-system';
import { getTranslations } from 'next-intl/server';
import { FrameworksPageActions } from './components/FrameworksPageActions';
import { FrameworksTable } from './components/FrameworksTable';

export async function generateMetadata() {
  const t = await getTranslations('frameworks');
  return { title: t('list.title') };
}

type FrameworkWithScore = FrameworkInstanceWithControls & { complianceScore: number };

export default async function FrameworksPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId: organizationId } = await params;
  const t = await getTranslations('frameworks');

  const [frameworksRes, availableRes] = await Promise.all([
    serverApi.get<{ data: FrameworkWithScore[] }>(
      '/v1/frameworks?includeControls=true&includeScores=true',
    ),
    serverApi.get<{ data: FrameworkEditorFramework[] }>('/v1/frameworks/available'),
  ]);

  const frameworksData = frameworksRes.data?.data ?? [];
  const allFrameworks = availableRes.data?.data ?? [];

  const frameworksWithControls = frameworksData.map((item) => {
    const fw = { ...item };
    delete (fw as { complianceScore?: unknown }).complianceScore;
    return fw;
  });
  const complianceMap = new Map(frameworksData.map((fw) => [fw.id, fw.complianceScore ?? 0]));

  const availableToAdd = allFrameworks.filter(
    (framework) =>
      !frameworksWithControls.some(
        (fc) => fc.framework?.id === framework.id || fc.customFramework?.id === framework.id,
      ),
  );

  return (
    <PageLayout
      header={
        <PageHeader
          title={t('list.title')}
          actions={<FrameworksPageActions availableFrameworks={availableToAdd} />}
        />
      }
    >
      <FrameworksTable
        frameworks={frameworksWithControls}
        complianceMap={Object.fromEntries(complianceMap)}
        organizationId={organizationId}
      />
    </PageLayout>
  );
}
