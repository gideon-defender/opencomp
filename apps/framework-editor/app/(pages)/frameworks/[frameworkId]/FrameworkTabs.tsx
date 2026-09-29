'use client';

import { confirmDiscardUnsavedChanges } from '@/app/lib/unsaved-changes';
import { Tabs, TabsList, TabsTrigger } from '@gideon-defender/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useSelectedLayoutSegment } from 'next/navigation';
import { useMemo } from 'react';

export function FrameworkTabs() {
  const { frameworkId } = useParams<{ frameworkId: string }>();
  const segment = useSelectedLayoutSegment();
  const t = useTranslations('frameworks');
  const tUnsaved = useTranslations('unsavedChanges');

  const tabs = useMemo(
    () => [
      { name: t('tabs.requirements'), href: `/frameworks/${frameworkId}`, segment: null },
      {
        name: t('tabs.controls'),
        href: `/frameworks/${frameworkId}/controls`,
        segment: 'controls',
      },
      {
        name: t('tabs.policies'),
        href: `/frameworks/${frameworkId}/policies`,
        segment: 'policies',
      },
      { name: t('tabs.tasks'), href: `/frameworks/${frameworkId}/tasks`, segment: 'tasks' },
      {
        name: t('tabs.documents'),
        href: `/frameworks/${frameworkId}/documents`,
        segment: 'documents',
      },
      {
        name: t('tabs.ismsDocuments'),
        href: `/frameworks/${frameworkId}/isms-documents`,
        segment: 'isms-documents',
      },
      {
        name: t('tabs.versions'),
        href: `/frameworks/${frameworkId}/versions`,
        segment: 'versions',
      },
    ],
    [frameworkId, t],
  );

  const activeValue = segment ?? 'requirements';

  return (
    <Tabs value={activeValue} className="w-full">
      <TabsList className="flex w-full">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.name}
            value={tab.segment ?? 'requirements'}
            className="flex-1"
            asChild
          >
            <Link
              href={tab.href}
              onClick={(event) => {
                if (!confirmDiscardUnsavedChanges(tUnsaved('confirmMessage')))
                  event.preventDefault();
              }}
            >
              {tab.name}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
