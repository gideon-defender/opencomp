'use client';

import { useApi } from '@/hooks/use-api';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@trycompai/design-system';
import {
  DocumentPdf,
  Launch,
  OverflowMenuVertical,
  TrashCan,
  Upload,
} from '@trycompai/design-system/icons';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import Dropzone from 'react-dropzone';
import { toast } from 'sonner';

interface PdfViewerProps {
  policyId: string;
  versionId?: string; // The version ID for version-specific operations
  pdfUrl?: string | null; // This prop contains the S3 Key
  isPendingApproval: boolean;
  /** Whether the current version is read-only (published or pending) */
  isVersionReadOnly?: boolean;
  /** Whether viewing the currently active/published version */
  isViewingActiveVersion?: boolean;
  /** Whether viewing a version pending approval */
  isViewingPendingVersion?: boolean;
  onMutate?: () => void;
}

export function PdfViewer({
  policyId,
  versionId,
  pdfUrl,
  isPendingApproval,
  isVersionReadOnly = false,
  isViewingActiveVersion = false,
  isViewingPendingVersion = false,
  onMutate,
}: PdfViewerProps) {
  // Combine both checks - can't modify if pending approval OR version is read-only
  const isReadOnly = isPendingApproval || isVersionReadOnly;
  const t = useTranslations('policies.pdfViewer');
  const api = useApi();
  const [files, setFiles] = useState<File[]>([]);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isUrlLoading, setUrlLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset to loading immediately when the PDF key changes so the previous
  // version's URL never flashes. Adjust-during-render; the fetch itself stays
  // in the effect below.
  const pdfKey = `${pdfUrl ?? ''}:${versionId ?? ''}`;
  const [prevPdfKey, setPrevPdfKey] = useState(pdfKey);
  if (prevPdfKey !== pdfKey) {
    setPrevPdfKey(pdfKey);
    setSignedUrl(null);
    setUrlLoading(true);
  }

  // Fetch the secure, temporary URL when the component loads with an S3 key.
  // Async IIFE with setState only after await (plus a cancellation flag) so
  // no setState runs synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pdfUrl) {
        // No PDF for this version - reset state
        await Promise.resolve();
        if (cancelled) return;
        setSignedUrl(null);
        setUrlLoading(false);
        return;
      }
      const query = versionId ? `?versionId=${versionId}` : '';
      try {
        const response = await api.get<{ url: string }>(
          `/v1/policies/${policyId}/pdf-url${query}`,
        );
        if (cancelled) return;
        if (response.data?.url) {
          setSignedUrl(response.data.url);
        } else {
          setSignedUrl(null);
        }
        setUrlLoading(false);
      } catch {
        if (cancelled) return;
        toast.error(t('loadFailedToast'));
        setUrlLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, policyId, versionId]);

  const handleReplaceClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      const file = selectedFiles[0];
      if (file.size > 100 * 1024 * 1024) {
        toast.error(t('fileTooLarge'));
        return;
      }
      handleUpload([file]);
    }
    // Reset input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle file upload from FileUploader component
  const handleUpload = async (uploadFiles: File[]) => {
    if (!uploadFiles.length) return;
    const file = uploadFiles[0]; // Only handle first file since we accept single files

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      const base64Data = (reader.result as string).split(',')[1];
      setIsUploading(true);
      try {
        const response = await api.post(`/v1/policies/${policyId}/pdf`, {
          versionId,
          fileName: file.name,
          fileType: file.type,
          fileData: base64Data,
        });
        if (response.error) {
          toast.error(response.error || t('uploadFailed'));
        } else {
          toast.success('PDF uploaded successfully.');
          setFiles([]);
          onMutate?.();
        }
      } catch {
        toast.error(t('uploadFailed'));
      } finally {
        setIsUploading(false);
      }
    };
    reader.onerror = () => toast.error(t('readFailed'));
  };

  // Handle direct drop on main card area
  const handleMainCardDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) {
      toast.error(t('noValidFile'));
      return;
    }

    if (acceptedFiles.length > 1) {
      toast.error(t('oneFileOnly'));
      return;
    }

    const file = acceptedFiles[0];
    if (file.size > 100 * 1024 * 1024) {
      toast.error(t('fileTooLarge'));
      return;
    }

    handleUpload(acceptedFiles);
  };

  const handleDeletePdf = async () => {
    setIsDeleting(true);
    try {
      const query = versionId ? `?versionId=${versionId}` : '';
      const response = await api.delete(`/v1/policies/${policyId}/pdf${query}`);
      if (response.error) {
        toast.error(response.error || t('deleteFailed'));
      } else {
        toast.success('PDF deleted successfully.');
        setSignedUrl(null);
        onMutate?.();
      }
    } catch {
      toast.error(t('deleteFailed'));
    } finally {
      setIsDeleting(false);
    }
  };

  const fileName = pdfUrl?.split('/').pop() || '';
  const MAX_FILENAME_LENGTH = 50;
  const truncatedFileName =
    fileName.length > MAX_FILENAME_LENGTH
      ? `${fileName.substring(0, MAX_FILENAME_LENGTH)}...`
      : fileName;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <CardTitle>
              {signedUrl ? (
                <a
                  href={signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline cursor-pointer flex items-center gap-2 min-w-0"
                  title={fileName}
                >
                  <span className="truncate">{truncatedFileName}</span>
                  <Launch size={16} className="shrink-0" />
                </a>
              ) : (
                <span className="truncate" title={fileName}>
                  {truncatedFileName}
                </span>
              )}
            </CardTitle>
          </div>
          {pdfUrl && !isReadOnly && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={handleFileInputChange}
                className="hidden"
                disabled={isUploading || isDeleting}
              />
              <DropdownMenu>
                <DropdownMenuTrigger variant="ellipsis" disabled={isUploading || isDeleting}>
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <OverflowMenuVertical size={16} />
                  )}
                  <span className="sr-only">{t('openMenu')}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={handleReplaceClick}
                    disabled={isUploading || isDeleting}
                  >
                    <Upload size={16} />
                    {t('replace')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={isUploading || isDeleting}
                    onClick={() => setIsDeleteDialogOpen(true)}
                  >
                    <TrashCan size={16} />
                    {t('deleteAction')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>{t('deleteDescription')}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        handleDeletePdf();
                        setIsDeleteDialogOpen(false);
                      }}
                      variant="destructive"
                      loading={isDeleting}
                    >
                      {t('deleteAction')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {isVersionReadOnly && pdfUrl && (
            <div className="flex items-center gap-4 rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-foreground">
              <span>
                {isViewingPendingVersion
                  ? t('pendingApprovalReadOnly')
                  : isViewingActiveVersion
                    ? t('publishedReadOnly')
                    : t('readOnlyGeneric')}
              </span>
            </div>
          )}
          {pdfUrl ? (
            <div className="space-y-4">
              {isUrlLoading ? (
                <div className="flex h-[800px] w-full items-center justify-center rounded-md border">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : signedUrl ? (
                <div className="relative">
                  <iframe
                    key={signedUrl}
                    src={`${signedUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                    className="h-[800px] w-full rounded-md border"
                    title={t('iframeTitle')}
                    onError={() => {
                      console.error('PDF failed to load in iframe, trying fallback');
                    }}
                  />
                </div>
              ) : (
                <div className="flex h-[800px] w-full flex-col items-center justify-center rounded-md border text-center">
                  <DocumentPdf size={48} className="text-destructive" />
                  <p className="mt-4 font-semibold">{t('loadFailedTitle')}</p>
                  <p className="text-sm text-muted-foreground">{t('loadFailedDescription')}</p>
                </div>
              )}
              {!isReadOnly && (
                <Dropzone
                  onDrop={handleMainCardDrop}
                  accept={{ 'application/pdf': [] }}
                  maxSize={100 * 1024 * 1024}
                  maxFiles={1}
                  multiple={false}
                  disabled={isUploading || isDeleting}
                >
                  {({ getRootProps, getInputProps, isDragActive }) => (
                    <div
                      {...getRootProps()}
                      className={cn(
                        'cursor-pointer rounded-md border-2 border-dashed p-4 text-center transition-colors',
                        isDragActive
                          ? 'border-primary bg-primary/10 dark:border-primary dark:bg-primary/10'
                          : 'border-primary/30 hover:border-primary/50 dark:border-primary/30 dark:hover:border-primary/50',
                        (isUploading || isDeleting) && 'pointer-events-none opacity-60',
                      )}
                    >
                      <input {...getInputProps()} />
                      <p className="text-sm text-muted-foreground">
                        {isUploading
                          ? t('uploadingNew')
                          : isDeleting
                            ? t('deleting')
                            : isDragActive
                              ? t('dropReplaceActive')
                              : t('dropReplace')}
                      </p>
                    </div>
                  )}
                </Dropzone>
              )}
            </div>
          ) : !isReadOnly ? (
            <Dropzone
              onDrop={handleMainCardDrop}
              accept={{ 'application/pdf': [] }}
              maxSize={100 * 1024 * 1024}
              maxFiles={1}
              multiple={false}
              disabled={isUploading || isDeleting}
            >
              {({ getRootProps, getInputProps, isDragActive }) => (
                <div
                  {...getRootProps()}
                  className={cn(
                    'flex cursor-pointer flex-col items-center justify-center space-y-4 rounded-md border-2 border-dashed p-12 text-center transition-colors',
                    isDragActive
                      ? 'border-primary bg-primary/10 dark:border-primary dark:bg-primary/10'
                      : 'border-primary/30 hover:border-primary/50 dark:border-primary/30 dark:hover:border-primary/50',
                    (isUploading || isDeleting) && 'pointer-events-none opacity-60',
                  )}
                >
                  <input {...getInputProps()} />
                  {isUploading ? (
                    <Loader2 className="h-12 w-12 animate-spin text-primary" />
                  ) : (
                    <DocumentPdf size={48} className="text-primary" />
                  )}
                  <h3 className="text-lg font-semibold">
                    {isUploading ? t('uploading') : isDragActive ? t('dropHereActive') : t('noPdf')}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {isUploading
                      ? t('pleaseWait')
                      : isDragActive
                        ? t('releaseToUpload')
                        : t('dropInitial')}
                  </p>
                </div>
              )}
            </Dropzone>
          ) : (
            <div className="flex flex-col items-center justify-center space-y-4 rounded-md border-2 border-dashed border-muted p-12 text-center">
              <DocumentPdf size={48} className="text-muted-foreground" />
              <h3 className="text-lg font-semibold">{t('noPdf')}</h3>
              <p className="text-sm text-muted-foreground">
                {isReadOnly ? t('emptyVersionNote') : t('emptyPolicyNote')}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
