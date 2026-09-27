import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  PageHeader,
  PageLayout,
} from '@trycompai/design-system';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { Overview } from './components/Overview';

export default async function HomePage() {
  const t = await getTranslations('overview');
  return (
    <PageLayout>
      <PageHeader title={t('pageTitle')} />
      <Suspense
        fallback={
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('loadingTitle')}</EmptyTitle>
              <EmptyDescription>{t('loadingDescription')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      >
        <Overview />
      </Suspense>
    </PageLayout>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('overview');
  return {
    title: t('pageTitle'),
  };
}
