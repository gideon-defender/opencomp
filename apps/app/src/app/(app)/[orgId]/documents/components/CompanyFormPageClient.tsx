'use client';

import { conciseFormDescriptions } from '@/app/(app)/[orgId]/documents/form-descriptions';
import {
  evidenceFormDefinitions,
  meetingSubTypeValues,
  meetingSubTypes,
  type EvidenceFormType,
  type MeetingSubType,
} from '@/app/(app)/[orgId]/documents/forms';
import { usePermissions } from '@/hooks/use-permissions';
import { api } from '@/lib/api-client';
import { useActiveMember } from '@/utils/auth-client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gideon-defender/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gideon-defender/ui/select';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  PageHeader,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from '@trycompai/design-system';
import {
  Add,
  Catalog,
  Download,
  OverflowMenuVertical,
  Search,
  TrashCan,
  Upload,
} from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import useSWR, { useSWRConfig } from 'swr';
import { formFieldLabel } from '../form-description-labels';
import { StatusBadge, formatSubmissionDate } from './submission-utils';

// ─── Types ───────────────────────────────────────────────────

type EvidenceSubmissionRow = {
  id: string;
  submittedAt: string;
  status: string;
  formType?: string;
  data: Record<string, unknown>;
  submittedBy?: {
    name: string | null;
    email: string;
  } | null;
};

type EvidenceFormResponse = {
  form: (typeof evidenceFormDefinitions)[EvidenceFormType];
  submissions: EvidenceSubmissionRow[];
  total: number;
};

const MEETING_SUB_TYPES = meetingSubTypeValues;

type DocumentsTranslator = ReturnType<typeof useTranslations<'documents'>>;

/** Meeting-type badge labels, resolved from translations. */
function meetingTypeLabel(t: DocumentsTranslator, formType: string): string {
  switch (formType) {
    case 'board-meeting':
      return t('companyForm.meetingTypes.board');
    case 'it-leadership-meeting':
      return t('companyForm.meetingTypes.itLeadership');
    case 'risk-committee-meeting':
      return t('companyForm.meetingTypes.riskCommittee');
    default:
      return formType;
  }
}

const submissionDateColumnWidth = 128;
const submittedByColumnWidth = 128;
const statusColumnWidth = 176;
const meetingTypeColumnWidth = 140;
const summaryColumnWidth = 280;
const actionsColumnWidth = 80;

// ─── Helpers ─────────────────────────────────────────────────

function truncate(str: string, max: number) {
  if (str.length <= max) return str;
  return `${str.slice(0, max)}…`;
}

function getMatrixRowCount(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.filter((row) => row && typeof row === 'object').length;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] ?? '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function evidenceFormFetcher(
  [endpoint]: readonly [string, string],
  loadFailedMessage: string,
): Promise<EvidenceFormResponse> {
  const response = await api.get<EvidenceFormResponse>(endpoint);
  if (response.error || !response.data) {
    throw new Error(response.error ?? loadFailedMessage);
  }
  return response.data;
}

// ─── Main Component ──────────────────────────────────────────

export function CompanyFormPageClient({
  organizationId,
  formType,
}: {
  organizationId: string;
  formType: EvidenceFormType;
  isPlatformAdmin?: boolean;
}) {
  const t = useTranslations('documents');
  const tIsms = useTranslations('isms');
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultTab = searchParams.get('tab') || 'submissions';
  const { mutate: globalMutate } = useSWRConfig();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('evidence', 'create');
  const canRead = hasPermission('evidence', 'read');
  const [search, setSearch] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedMeetingType, setSelectedMeetingType] = useState<MeetingSubType>('board-meeting');
  const [uploadSelectPortalRoot, setUploadSelectPortalRoot] = useState<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [submissionToDelete, setSubmissionToDelete] = useState<EvidenceSubmissionRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: activeMember } = useActiveMember();
  const memberRoles = activeMember?.role?.split(',').map((role: string) => role.trim()) || [];
  const isAdminOrOwner = memberRoles.includes('admin') || memberRoles.includes('owner');

  const isMeeting = formType === 'meeting';
  const formDefinition = evidenceFormDefinitions[formType];
  const summaryField = formDefinition.fields.find((field) => field.type === 'textarea');
  const matrixSummaryField = formDefinition.fields.find((field) => field.type === 'matrix');
  const hasMatrixSummary = Boolean(matrixSummaryField);
  const showSummaryColumn = Boolean(summaryField) || hasMatrixSummary;

  const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';

  const meetingSwrKeys = useMemo(
    () =>
      isMeeting
        ? MEETING_SUB_TYPES.map(
            (subType) => [`/v1/evidence-forms/${subType}${query}`, organizationId] as const,
          )
        : [],
    [isMeeting, query, organizationId],
  );

  const swrKey: readonly [string, string] | null = isMeeting
    ? null
    : [`/v1/evidence-forms/${formType}${query}`, organizationId];

  const loadSubmissions = useCallback(
    (key: readonly [string, string]) => evidenceFormFetcher(key, t('companyForm.loadFailed')),
    [t],
  );

  const { data: singleData } = useSWR<EvidenceFormResponse>(swrKey, loadSubmissions);

  const { data: meetingData0 } = useSWR<EvidenceFormResponse>(
    meetingSwrKeys[0] ?? null,
    loadSubmissions,
  );
  const { data: meetingData1 } = useSWR<EvidenceFormResponse>(
    meetingSwrKeys[1] ?? null,
    loadSubmissions,
  );
  const { data: meetingData2 } = useSWR<EvidenceFormResponse>(
    meetingSwrKeys[2] ?? null,
    loadSubmissions,
  );

  const mergedMeetingSubmissions = useMemo(() => {
    if (!isMeeting) return [];
    const all: EvidenceSubmissionRow[] = [];
    const sources = [
      { data: meetingData0, subType: MEETING_SUB_TYPES[0] },
      { data: meetingData1, subType: MEETING_SUB_TYPES[1] },
      { data: meetingData2, subType: MEETING_SUB_TYPES[2] },
    ];
    for (const { data: d, subType } of sources) {
      if (!d) continue;
      for (const sub of d.submissions) {
        all.push({ ...sub, formType: subType });
      }
    }
    all.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
    return all;
  }, [isMeeting, meetingData0, meetingData1, meetingData2]);

  const data = isMeeting
    ? mergedMeetingSubmissions.length > 0 || meetingData0 || meetingData1 || meetingData2
      ? {
          form: formDefinition,
          submissions: mergedMeetingSubmissions,
          total: mergedMeetingSubmissions.length,
        }
      : undefined
    : singleData;

  const handleExportCsv = async () => {
    if (!data || data.total === 0) {
      toast.error(t('companyForm.noSubmissionsToExport'));
      return;
    }

    setIsExporting(true);
    try {
      const exportTypes = isMeeting ? MEETING_SUB_TYPES : [formType];
      const results: { blob: Blob; exportType: string }[] = [];

      for (const exportType of exportTypes) {
        const response = await api.raw(`/v1/evidence-forms/${exportType}/export.csv`, {
          method: 'GET',
          organizationId,
        });

        if (response.status === 400) {
          continue;
        }

        if (!response.ok) {
          throw new Error(await response.text());
        }

        results.push({ blob: await response.blob(), exportType });
      }

      if (results.length === 0) {
        toast.error(t('companyForm.noSubmissionsToExport'));
        return;
      }

      for (const { blob, exportType } of results) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${exportType}-submissions.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('companyForm.csvExportFailed'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleUploadEvidence = useCallback(async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    try {
      const fileData = await fileToBase64(selectedFile);
      const submitFormType = isMeeting ? selectedMeetingType : formType;

      const response = await api.post(`/v1/evidence-forms/${submitFormType}/upload-submission`, {
        fileName: selectedFile.name,
        fileType: selectedFile.type || 'application/octet-stream',
        fileData,
      });

      if (response.error) {
        throw new Error(response.error);
      }

      toast.success(t('companyForm.evidenceUploaded'));
      setIsUploadOpen(false);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      if (isMeeting) {
        for (const subType of MEETING_SUB_TYPES) {
          globalMutate([`/v1/evidence-forms/${subType}${query}`, organizationId]);
        }
      } else {
        globalMutate([`/v1/evidence-forms/${formType}${query}`, organizationId]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('companyForm.uploadFailed'));
    } finally {
      setIsUploading(false);
    }
  }, [
    selectedFile,
    selectedMeetingType,
    isMeeting,
    formType,
    organizationId,
    query,
    globalMutate,
    t,
  ]);

  const handleConfirmDelete = useCallback(async () => {
    if (!submissionToDelete) return;

    const submissionFormType = (submissionToDelete.formType ?? formType) as EvidenceFormType;
    setIsDeleting(true);
    try {
      const response = await api.delete<{ success: boolean; id: string }>(
        `/v1/evidence-forms/${submissionFormType}/submissions/${submissionToDelete.id}`,
        organizationId,
      );

      if (response.error || !response.data?.success) {
        throw new Error(response.error ?? t('companyForm.deleteSubmissionFailed'));
      }

      toast.success(t('companyForm.submissionDeleted'));
      setDeleteDialogOpen(false);
      setSubmissionToDelete(null);

      if (isMeeting) {
        for (const subType of MEETING_SUB_TYPES) {
          globalMutate([`/v1/evidence-forms/${subType}${query}`, organizationId]);
        }
        for (const subType of MEETING_SUB_TYPES) {
          globalMutate([`/v1/findings?evidenceFormType=${subType}`, organizationId]);
        }
        globalMutate([`/v1/findings?evidenceFormType=meeting`, organizationId]);
      } else {
        globalMutate([`/v1/evidence-forms/${formType}${query}`, organizationId]);
        globalMutate([`/v1/findings?evidenceFormType=${formType}`, organizationId]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('companyForm.deleteSubmissionFailed'));
    } finally {
      setIsDeleting(false);
    }
  }, [submissionToDelete, formType, isMeeting, organizationId, query, globalMutate, t]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={formDefinition.title}
        actions={
          <div className="flex items-center gap-2">
            {canCreate && (
              <>
                <Link href={`/${organizationId}/documents/${formType}/new`}>
                  <Button iconLeft={<Add size={16} />}>{t('companyForm.newSubmission')}</Button>
                </Link>
                <Button
                  type="button"
                  variant="secondary"
                  iconLeft={<Upload size={16} />}
                  onClick={() => setIsUploadOpen(true)}
                >
                  {t('companyForm.uploadEvidence')}
                </Button>
              </>
            )}
            {canRead && (
              <Button
                type="button"
                variant="secondary"
                iconLeft={<Download size={16} />}
                onClick={handleExportCsv}
                disabled={isExporting}
              >
                {isExporting ? t('companyForm.exporting') : t('companyForm.exportCsv')}
              </Button>
            )}
          </div>
        }
      />
      <div className="line-clamp-1">
        <Text variant="muted">
          {conciseFormDescriptions[formType]
            ? formFieldLabel(tIsms, formType)
            : formDefinition.description}
        </Text>
      </div>

      <Tabs defaultValue={defaultTab}>
        <Stack gap="lg">
          <TabsList variant="underline">
            <TabsTrigger value="submissions">{t('companyForm.submissionsTab')}</TabsTrigger>
          </TabsList>

          <TabsContent value="submissions">
            <div className="space-y-3">
              <div className="w-full md:max-w-[300px]">
                <InputGroup>
                  <InputGroupAddon>
                    <Search size={16} />
                  </InputGroupAddon>
                  <InputGroupInput
                    placeholder={t('companyForm.searchPlaceholder')}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </InputGroup>
              </div>

              {!data || data.submissions.length === 0 ? (
                <Empty>
                  <EmptyMedia variant="icon">
                    <Catalog />
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>{t('companyForm.emptyTitle')}</EmptyTitle>
                    <EmptyDescription>{t('companyForm.emptyDescription')}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <Table variant="bordered" style={{ tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: submissionDateColumnWidth }} />
                    {isMeeting && <col style={{ width: meetingTypeColumnWidth }} />}
                    <col style={{ width: submittedByColumnWidth }} />
                    {formType === 'access-request' && <col style={{ width: statusColumnWidth }} />}
                    {showSummaryColumn && <col style={{ width: summaryColumnWidth }} />}
                    {isAdminOrOwner && <col style={{ width: actionsColumnWidth }} />}
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <div className="whitespace-nowrap">
                          {t('companyForm.columns.submissionDate')}
                        </div>
                      </TableHead>
                      {isMeeting && (
                        <TableHead>
                          <div className="whitespace-nowrap">
                            {t('companyForm.columns.meetingType')}
                          </div>
                        </TableHead>
                      )}
                      <TableHead>
                        <div className="whitespace-nowrap">
                          {t('companyForm.columns.submittedBy')}
                        </div>
                      </TableHead>
                      {formType === 'access-request' && (
                        <TableHead>
                          <div className="whitespace-nowrap">{t('companyForm.columns.status')}</div>
                        </TableHead>
                      )}
                      {showSummaryColumn && (
                        <TableHead>{t('companyForm.columns.summary')}</TableHead>
                      )}
                      {isAdminOrOwner && (
                        <TableHead>
                          <div className="whitespace-nowrap">
                            {t('companyForm.columns.actions')}
                          </div>
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.submissions.map((submission) => {
                      const summaryValue = summaryField
                        ? String(submission.data[summaryField.key] ?? '')
                        : '';
                      const matrixSummary = matrixSummaryField
                        ? t('companyForm.rowCount', {
                            count: getMatrixRowCount(submission.data[matrixSummaryField.key]),
                          })
                        : '';
                      const rowSummary = summaryField ? truncate(summaryValue, 80) : matrixSummary;

                      const submissionFormType = submission.formType ?? formType;

                      return (
                        <TableRow
                          key={submission.id}
                          onClick={() =>
                            router.push(
                              `/${organizationId}/documents/${submissionFormType}/submissions/${submission.id}`,
                            )
                          }
                          style={{ cursor: 'pointer' }}
                        >
                          <TableCell>
                            <div className="whitespace-nowrap">
                              {formatSubmissionDate(
                                submission.data.submissionDate,
                                submission.submittedAt,
                              )}
                            </div>
                          </TableCell>
                          {isMeeting && (
                            <TableCell>
                              <Badge variant="secondary">
                                {meetingTypeLabel(t, submissionFormType)}
                              </Badge>
                            </TableCell>
                          )}
                          <TableCell>
                            <span className="block truncate">
                              {submission.submittedBy?.name ??
                                submission.submittedBy?.email ??
                                t('companyForm.unknown')}
                            </span>
                          </TableCell>
                          {formType === 'access-request' && (
                            <TableCell>
                              <div>
                                <StatusBadge status={submission.status} />
                              </div>
                            </TableCell>
                          )}
                          {showSummaryColumn && (
                            <TableCell>
                              <span className="block truncate text-muted-foreground">
                                {rowSummary || '—'}
                              </span>
                            </TableCell>
                          )}
                          {isAdminOrOwner && (
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-center">
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    variant="ellipsis"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <OverflowMenuVertical />
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSubmissionToDelete(submission);
                                        setDeleteDialogOpen(true);
                                      }}
                                    >
                                      <TrashCan size={16} />
                                      {t('companyForm.delete')}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>
        </Stack>
      </Tabs>

      <Dialog
        open={isUploadOpen}
        onOpenChange={(open) => {
          setIsUploadOpen(open);
          if (!open) {
            setSelectedFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('companyForm.uploadTitle')}</DialogTitle>
            <DialogDescription>{t('companyForm.uploadDescription')}</DialogDescription>
          </DialogHeader>
          <div ref={setUploadSelectPortalRoot} className="min-w-0 space-y-4 overflow-visible">
            {isMeeting && (
              <Field>
                <div className="flex flex-row items-center gap-4">
                  <div className="shrink-0">
                    <FieldLabel htmlFor="upload-meeting-type">
                      {t('companyForm.meetingTypeLabel')}
                    </FieldLabel>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Select
                      value={selectedMeetingType}
                      onValueChange={(value) => setSelectedMeetingType(value as MeetingSubType)}
                    >
                      <SelectTrigger id="upload-meeting-type">
                        <SelectValue placeholder={t('companyForm.meetingTypePlaceholder')}>
                          {meetingSubTypes.find((m) => m.value === selectedMeetingType)?.label ??
                            t('companyForm.meetingTypePlaceholder')}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent container={uploadSelectPortalRoot}>
                        {meetingSubTypes.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </Field>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.md,.markdown,.csv,application/pdf,image/png,image/jpeg,text/markdown,text/csv"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-foreground file:mr-4 file:rounded-md file:border-0 file:bg-muted file:px-4 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted/80 file:cursor-pointer cursor-pointer"
            />
            {selectedFile && (
              <Text size="sm" variant="muted">
                {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
              </Text>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsUploadOpen(false)}
              disabled={isUploading}
            >
              {t('companyForm.cancel')}
            </Button>
            <Button
              type="button"
              onClick={handleUploadEvidence}
              disabled={!selectedFile || isUploading}
              loading={isUploading}
            >
              {t('companyForm.upload')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setSubmissionToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('companyForm.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('companyForm.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t('companyForm.cancel')}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              loading={isDeleting}
            >
              {isDeleting ? t('companyForm.deleting') : t('companyForm.delete')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
