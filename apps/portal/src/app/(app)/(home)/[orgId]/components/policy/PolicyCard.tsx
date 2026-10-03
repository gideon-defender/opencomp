'use client';

import type { Member, Policy, PolicyVersion } from '@db';
import type { JSONContent } from '@tiptap/react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Text,
} from '@trycompai/design-system';
import { ArrowRight } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PolicyEditor } from './PolicyEditor';
import { PortalPdfViewer } from './PortalPdfViewer';

type PolicyWithVersion = Policy & {
  currentVersion?: Pick<PolicyVersion, 'id' | 'content' | 'pdfUrl' | 'version'> | null;
};

interface PolicyCardProps {
  policy: PolicyWithVersion;
  onNext?: () => void;
  onComplete?: () => void;
  onClick?: () => void;
  member: Member;
  isLastPolicy?: boolean;
}

export function PolicyCard({ policy, onNext, onComplete, member, isLastPolicy }: PolicyCardProps) {
  const [isAccepted, setIsAccepted] = useState(policy.signedBy.includes(member.id));
  const t = useTranslations('policies');

  const handleAccept = () => {
    setIsAccepted(true);
    onComplete?.();
  };

  // Use currentVersion content/pdfUrl if available, fallback to policy level for backward compatibility
  const effectivePdfUrl = policy.currentVersion?.pdfUrl ?? policy.pdfUrl;
  const effectiveContent = policy.currentVersion?.content ?? policy.content;
  const isPdfPolicy = policy.displayFormat === 'PDF' && effectivePdfUrl;

  return (
    <div className="relative">
      <Card>
        {isAccepted && (
          <div className="bg-background/80 absolute inset-0 z-10 flex items-center justify-center backdrop-blur-xs">
            <div className="space-y-4 text-center">
              <Text weight="medium">{t('policyAccepted')}</Text>
              <Text variant="muted">{t('youAcceptedPolicy')}</Text>
              <div className="flex justify-center gap-2">
                <Button variant="outline" onClick={() => setIsAccepted(false)}>
                  {t('viewAgain')}
                </Button>
                {!isLastPolicy && (
                  <Button onClick={onNext} iconRight={<ArrowRight size={16} />}>
                    {t('nextPolicy')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
        <CardHeader>
          <CardTitle>{policy.name}</CardTitle>
          <CardDescription>{policy.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full border-t border-border pt-6">
            <div className="max-w-none">
              {isPdfPolicy ? (
                <PortalPdfViewer
                  policyId={policy.id}
                  s3Key={effectivePdfUrl}
                  versionId={policy.currentVersion?.id}
                />
              ) : (
                <PolicyEditor content={effectiveContent as JSONContent[]} />
              )}
            </div>
            <Text variant="muted" size="sm">
              {t('statusLabel', { status: policy.status })}{' '}
              {policy.updatedAt && (
                <span>
                  ({t('lastUpdated', { date: new Date(policy.updatedAt).toLocaleDateString() })})
                </span>
              )}
            </Text>
          </div>
        </CardContent>
        <CardFooter>
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {policy.updatedAt && (
                <Text variant="muted" size="sm">
                  {t('lastUpdated', { date: new Date(policy.updatedAt).toLocaleDateString() })}
                </Text>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={handleAccept}>{t('acceptPolicy')}</Button>
            </div>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
