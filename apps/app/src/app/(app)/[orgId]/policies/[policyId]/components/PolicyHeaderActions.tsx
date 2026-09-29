'use client';

import { useAuditLogs } from '@/hooks/use-audit-logs';
import { usePermissions } from '@/hooks/use-permissions';
import type { Member, Policy, PolicyVersion, User } from '@db';
import { useRealtimeRun } from '@gideon-defender/trigger-react';
import { Button } from '@gideon-defender/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gideon-defender/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@gideon-defender/ui/dropdown-menu';
import { Icons } from '@gideon-defender/ui/icons';
import type { JSONContent } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSWRConfig } from 'swr';
import { auditLogsKey } from '../hooks/useAuditLogs';
import { policyKey, usePolicy } from '../hooks/usePolicy';
import { policyVersionsKey } from '../hooks/usePolicyVersions';

type PolicyWithVersion = Policy & {
  approver: (Member & { user: User }) | null;
  currentVersion?: PolicyVersion | null;
};

export function PolicyHeaderActions({
  policy,
  organizationId,
}: {
  policy: PolicyWithVersion | null;
  organizationId: string;
}) {
  const router = useRouter();
  const t = useTranslations('policies');
  const { mutate: globalMutate } = useSWRConfig();
  const [isRegenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const { regeneratePolicy, getPdfUrl } = usePolicy({
    policyId: policy?.id ?? '',
    organizationId,
  });

  const { logs: auditLogs } = useAuditLogs({
    entityType: 'policy',
    entityId: policy?.id ?? '',
  });

  // Real-time task tracking
  const [runInfo, setRunInfo] = useState<{
    runId: string;
    accessToken: string;
  } | null>(null);
  const toastIdRef = useRef<string | number | null>(null);

  // Subscribe to run status when we have a runId
  const { run } = useRealtimeRun(runInfo?.runId ?? '', {
    accessToken: runInfo?.accessToken ?? '',
    enabled: !!runInfo?.runId && !!runInfo?.accessToken,
  });

  const revalidateAll = () => {
    if (!policy) return;
    globalMutate(policyKey(policy.id, organizationId));
    globalMutate(policyVersionsKey(policy.id, organizationId));
    globalMutate(auditLogsKey('policy', policy.id));
  };

  // Handle run completion. Async IIFE with setState only after await (plus a
  // cancellation flag) so no setState runs synchronously in the effect body.
  useEffect(() => {
    if (!run) return;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (run.status === 'COMPLETED') {
        if (toastIdRef.current) {
          toast.dismiss(toastIdRef.current);
        }
        toast.success(t('headerActions.newDraftCreatedToast'));
        setIsRegenerating(false);
        setRunInfo(null);
        toastIdRef.current = null;
        revalidateAll();
      } else if (run.status === 'FAILED' || run.status === 'CRASHED' || run.status === 'CANCELED') {
        if (toastIdRef.current) {
          toast.dismiss(toastIdRef.current);
        }
        toast.error(t('headerActions.regenerateFailedToast'));
        setIsRegenerating(false);
        setRunInfo(null);
        toastIdRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [run]);

  const handleRegenerate = async () => {
    if (!policy) return;
    setIsRegenerating(true);
    setRegenerateConfirmOpen(false);

    try {
      const response = await regeneratePolicy();

      const { runId, publicAccessToken } = response.data?.data ?? {};
      if (runId && publicAccessToken) {
        const toastId = toast.loading(t('headerActions.regeneratingToast'));
        toastIdRef.current = toastId;

        setRunInfo({ runId, accessToken: publicAccessToken });
      }
    } catch {
      toast.error(t('headerActions.regenerateTriggerFailedToast'));
      setIsRegenerating(false);
    }
  };

  const updateQueryParam = ({ key, value }: { key: string; value: string }) => {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);
    router.push(`${url.pathname}?${url.searchParams.toString()}`);
  };

  const handleDownloadPDF = async () => {
    if (!policy) {
      toast.error(t('headerActions.policyNotAvailableToast'));
      return;
    }

    setIsDownloading(true);

    try {
      // Always call the API to check for an uploaded PDF (also creates audit log)
      const url = await getPdfUrl(policy.currentVersion?.id);

      if (url) {
        // Download the uploaded PDF directly
        const link = document.createElement('a');
        link.href = url;
        link.download = `${policy.name || 'Policy'}.pdf`;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }

      // Fall back to generating PDF from content
      const contentSource = policy.currentVersion?.content ?? policy.content;

      if (!contentSource) {
        toast.error(t('headerActions.contentNotAvailableToast'));
        return;
      }

      // Convert content to JSONContent array
      let policyContent: JSONContent[];
      if (Array.isArray(contentSource)) {
        policyContent = contentSource as JSONContent[];
      } else if (typeof contentSource === 'object' && contentSource !== null) {
        policyContent = [contentSource as JSONContent];
      } else {
        toast.error(t('headerActions.invalidContentFormatToast'));
        return;
      }

      // Generate and download the PDF
      const approvalLogs = auditLogs.filter((log) =>
        log.description?.toLowerCase().includes('approved'),
      );
      const { generatePolicyPDF } = await import('@/lib/pdf-generator');
      await generatePolicyPDF(policyContent, approvalLogs, policy.name || 'Policy Document');
    } catch (error) {
      console.error('Error downloading policy PDF:', error);
      toast.error(t('headerActions.downloadFailedToast'));
    } finally {
      setIsDownloading(false);
      // Revalidate audit logs so the activity tab reflects the download
      globalMutate(auditLogsKey('policy', policy.id));
    }
  };

  const { hasPermission } = usePermissions();
  const canUpdate = hasPermission('policy', 'update');
  const canDelete = hasPermission('policy', 'delete');

  if (!policy) return null;

  const isPendingApproval = !!policy.approverId;

  // Hide entire menu if user has no write permissions
  if (!canUpdate && !canDelete) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="m-0 size-auto p-2">
            <Icons.Settings className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canUpdate && policy?.policyTemplateId && (
            <DropdownMenuItem
              onClick={() => setRegenerateConfirmOpen(true)}
              disabled={isPendingApproval || isRegenerating}
            >
              <Icons.AI className="mr-2 h-4 w-4" />{' '}
              {isRegenerating ? t('headerActions.regenerating') : t('headerActions.regenerate')}
            </DropdownMenuItem>
          )}
          {canUpdate && (
            <DropdownMenuItem
              onClick={() => {
                updateQueryParam({ key: 'policy-overview-sheet', value: 'true' });
              }}
            >
              <Icons.Edit className="mr-2 h-4 w-4" /> {t('headerActions.edit')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handleDownloadPDF()} disabled={isDownloading}>
            <Icons.Download className="mr-2 h-4 w-4" />{' '}
            {isDownloading ? t('headerActions.downloading') : t('headerActions.downloadPdf')}
          </DropdownMenuItem>
          {canUpdate && (
            <DropdownMenuItem
              onClick={() => {
                updateQueryParam({ key: 'archive-policy-sheet', value: 'true' });
              }}
            >
              <Icons.InboxCustomize className="mr-2 h-4 w-4" /> {t('headerActions.archiveRestore')}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem
              onClick={() => {
                updateQueryParam({ key: 'delete-policy', value: 'true' });
              }}
              className="text-destructive"
            >
              <Icons.Delete className="mr-2 h-4 w-4" /> {t('headerActions.delete')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Regenerate Confirmation Dialog */}
      <Dialog open={isRegenerateConfirmOpen} onOpenChange={setRegenerateConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('headerActions.regenerateTitle')}</DialogTitle>
            <DialogDescription>{t('headerActions.regenerateDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegenerateConfirmOpen(false)}>
              {t('headerActions.cancel')}
            </Button>
            <Button onClick={handleRegenerate} disabled={isRegenerating}>
              {isRegenerating ? t('headerActions.working') : t('headerActions.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
