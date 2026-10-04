'use client';

import { apiClient } from '@/app/lib/api-client';
import { Button } from '@gideon-defender/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gideon-defender/ui/dialog';
import { FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

interface ImportFrameworkDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

interface ImportPreview {
  frameworkName: string;
  frameworkVersion: string;
  requirementsCount: number;
  controlTemplatesCount: number;
  policyTemplatesCount: number;
  taskTemplatesCount: number;
}

interface ImportErrorMessages {
  unsupportedVersion: string;
  invalidFile: string;
}

function parseImportFile(
  json: Record<string, unknown>,
  messages: ImportErrorMessages,
): ImportPreview | string {
  if (typeof json.version !== 'string' || json.version !== '1') {
    return messages.unsupportedVersion;
  }

  const fw = json.framework as Record<string, unknown> | undefined;
  if (!fw || typeof fw.name !== 'string' || typeof fw.version !== 'string') {
    return messages.invalidFile;
  }

  return {
    frameworkName: fw.name,
    frameworkVersion: fw.version,
    requirementsCount: Array.isArray(json.requirements) ? json.requirements.length : 0,
    controlTemplatesCount: Array.isArray(json.controlTemplates) ? json.controlTemplates.length : 0,
    policyTemplatesCount: Array.isArray(json.policyTemplates) ? json.policyTemplates.length : 0,
    taskTemplatesCount: Array.isArray(json.taskTemplates) ? json.taskTemplates.length : 0,
  };
}

export function ImportFrameworkDialog({ isOpen, onOpenChange }: ImportFrameworkDialogProps) {
  const router = useRouter();
  const t = useTranslations('dialogs');
  const tToasts = useTranslations('toasts');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileData, setFileData] = useState<Record<string, unknown> | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const handleReset = useCallback(() => {
    setFileData(null);
    setPreview(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setError(null);
      setPreview(null);
      setFileData(null);

      const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
      if (file.size > MAX_FILE_SIZE) {
        setError(t('importFramework.fileTooLarge'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string);
          const result = parseImportFile(json, {
            unsupportedVersion: t('importFramework.unsupportedVersion'),
            invalidFile: t('importFramework.invalidFile'),
          });
          if (typeof result === 'string') {
            setError(result);
          } else {
            setPreview(result);
            setFileData(json);
          }
        } catch {
          setError(t('importFramework.parseFailed'));
        }
      };
      reader.readAsText(file);
    },
    [t],
  );

  const handleImport = useCallback(async () => {
    if (!fileData) {
      return;
    }

    setIsImporting(true);
    try {
      const result = await apiClient('/framework/import', {
        method: 'POST',
        body: JSON.stringify(fileData),
      });
      toast.success(tToasts('frameworkImported'));
      onOpenChange(false);
      handleReset();
      router.refresh();
    } catch (err) {
      console.error('[ImportFramework] Error:', err);
      const message = err instanceof Error ? err.message : tToasts('importFailed');
      toast.error(message);
    } finally {
      setIsImporting(false);
    }
  }, [fileData, onOpenChange, handleReset, router, tToasts]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleReset();
        onOpenChange(open);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('importFramework.title')}</DialogTitle>
          <DialogDescription>{t('importFramework.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div
            className="border-border hover:border-foreground/30 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-8 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp className="text-muted-foreground h-8 w-8" />
            <p className="text-muted-foreground text-sm">
              {preview ? t('importFramework.chooseDifferent') : t('importFramework.chooseFile')}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {error && (
            <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">{error}</div>
          )}

          {preview && (
            <div className="bg-muted rounded-md p-4">
              <h4 className="mb-2 font-medium">
                {preview.frameworkName}{' '}
                <span className="text-muted-foreground text-sm font-normal">
                  v{preview.frameworkVersion}
                </span>
              </h4>
              <div className="text-muted-foreground grid grid-cols-2 gap-1 text-sm">
                <span>{t('importFramework.requirementsLabel')}</span>
                <span className="font-mono">{preview.requirementsCount}</span>
                <span>{t('importFramework.controlTemplatesLabel')}</span>
                <span className="font-mono">{preview.controlTemplatesCount}</span>
                <span>{t('importFramework.policyTemplatesLabel')}</span>
                <span className="font-mono">{preview.policyTemplatesCount}</span>
                <span>{t('importFramework.taskTemplatesLabel')}</span>
                <span className="font-mono">{preview.taskTemplatesCount}</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('importFramework.cancel')}
            </Button>
          </DialogClose>
          <Button onClick={handleImport} disabled={!fileData || isImporting}>
            {isImporting ? t('importFramework.importing') : t('importFramework.import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
