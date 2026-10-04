import { TaskOverview } from '@/components/risks/tasks/task-overview';
import { serverApi } from '@/lib/api-server';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ riskId: string; taskId: string }>;
}

export default async function RiskPage({ params }: PageProps) {
  const { taskId } = await params;

  const [taskResult, peopleResult] = await Promise.all([
    serverApi.get<any>(`/v1/tasks/${taskId}`),
    serverApi.get<any>('/v1/people'),
  ]);

  const task = taskResult.data;
  if (!task) {
    redirect('/');
  }

  // Extract users from people response (same shape as getUsers helper)
  const users = (peopleResult.data?.data ?? []).map((p: any) => p.user);

  return (
    <div className="flex flex-col gap-4">
      <TaskOverview task={task} users={users} />
    </div>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('risk');
  return {
    title: t('detail.taskMetadataTitle'),
  };
}
