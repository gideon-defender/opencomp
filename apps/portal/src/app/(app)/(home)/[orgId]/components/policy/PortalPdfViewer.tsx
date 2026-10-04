'use client';

import {
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Text,
} from '@trycompai/design-system';
import { Document } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface PortalPdfViewerProps {
  policyId: string;
  s3Key?: string | null;
  versionId?: string;
}

export function PortalPdfViewer({ policyId, s3Key, versionId }: PortalPdfViewerProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const t = useTranslations('policies');

  useEffect(() => {
    if (!s3Key) {
      // Deferred out of the effect body; flushes before paint, same as before.
      queueMicrotask(() => setIsLoading(false));
      return;
    }

    let cancelled = false;

    const fetchPdfUrl = async () => {
      try {
        const params = new URLSearchParams({ policyId });
        if (versionId) {
          params.set('versionId', versionId);
        }
        const res = await fetch(`/api/portal/policy-pdf-url?${params}`, {
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error(t('loadDocumentFailed'));
        }
        const data = await res.json();
        if (!cancelled) {
          if (data.success && data.url) {
            setSignedUrl(data.url);
          } else {
            setSignedUrl(null);
            toast.error(t('loadDocumentFailed'));
          }
        }
      } catch {
        if (!cancelled) {
          toast.error(t('loadPolicyError'));
          setSignedUrl(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchPdfUrl();

    return () => {
      cancelled = true;
    };
  }, [s3Key, policyId, versionId, t]);

  if (isLoading) {
    return (
      <div className="flex min-h-[320px] w-full items-center justify-center rounded-md border border-border md:min-h-[420px]">
        <Text variant="muted">{t('loadingDocument')}</Text>
      </div>
    );
  }

  if (signedUrl) {
    return (
      <iframe
        key={signedUrl}
        src={signedUrl}
        className="h-[60vh] min-h-[320px] w-full rounded-md border border-border md:min-h-[420px]"
        title={t('pdfTitle')}
      />
    );
  }

  // Fallback UI if there's no PDF or an error occurs
  return (
    <Card>
      <CardContent>
        <Empty>
          <EmptyMedia variant="icon">
            <Document size={24} />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>{t('pdfUnavailableTitle')}</EmptyTitle>
            <EmptyDescription>{t('pdfUnavailableBody')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </CardContent>
    </Card>
  );
}
