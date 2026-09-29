import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  PageLayout,
} from '@trycompai/design-system';
import { getTranslations } from 'next-intl/server';

export default async function Unauthorized() {
  const t = await getTranslations('errors');
  return (
    <PageLayout>
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('unauthorizedTitle')}</EmptyTitle>
          <EmptyDescription>{t('unauthorizedDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </PageLayout>
  );
}
