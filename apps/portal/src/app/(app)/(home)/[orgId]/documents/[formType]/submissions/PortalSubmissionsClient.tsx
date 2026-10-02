'use client';

import { formatDateNumeric } from '@gideon-defender/utils/format';
import {
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  PageHeader,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@trycompai/design-system';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

type SubmissionRow = {
  id: string;
  submittedAt: string;
  status: string;
  reviewReason: string | null;
};

interface PortalSubmissionsClientProps {
  orgId: string;
  formType: string;
  formTitle: string;
  submissions: SubmissionRow[];
  showSuccess: boolean;
}

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('submissions');
  switch (status) {
    case 'approved':
      return (
        <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950/30 dark:text-green-400">
          Approved
        </span>
      );
    case 'rejected':
      return (
        <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/30 dark:text-red-400">
          Rejected
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-full bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-400">
          Pending
        </span>
      );
  }
}

function formatDate(value: unknown): string {
  if (typeof value !== 'string') return '—';
  return formatDateNumeric(value) || '—';
}

export function PortalSubmissionsClient({
  orgId,
  formType,
  formTitle,
  submissions,
  showSuccess,
}: PortalSubmissionsClientProps) {
  const t = useTranslations('submissions');
  return (
    <Stack gap="lg">
      <PageHeader title={t('pageTitle', { title: formTitle })} />
      <Text variant="muted">{t('pageDescription', { title: formTitle.toLowerCase() })}</Text>

      {showSuccess && (
        <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
          {t('savedPending')}
        </div>
      )}

      {submissions.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
          </EmptyHeader>
          <div className="mt-4">
            <Link href={`/${orgId}/documents/${formType}`}>
              <Button>{t('createSubmission')}</Button>
            </Link>
          </div>
        </Empty>
      ) : (
        <Table variant="bordered">
          <TableHeader>
            <TableRow>
              <TableHead>{t('date')}</TableHead>
              <TableHead>{t('status')}</TableHead>
              <TableHead>{t('reviewReason')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {submissions.map((submission) => (
              <TableRow key={submission.id}>
                <TableCell>{formatDate(submission.submittedAt)}</TableCell>
                <TableCell>
                  <StatusBadge status={submission.status} />
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground text-sm">
                    {submission.reviewReason || t('notAvailable')}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="flex items-center gap-3">
        <Link href={`/${orgId}/documents/${formType}`}>
          <Button>{t('newSubmission')}</Button>
        </Link>
      </div>
    </Stack>
  );
}
