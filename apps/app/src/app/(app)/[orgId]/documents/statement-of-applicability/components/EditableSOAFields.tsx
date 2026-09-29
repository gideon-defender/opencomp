'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@trycompai/design-system';
import { Close, Edit } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSOADocument } from '../hooks/useSOADocument';
import { ApplicableReadOnlyDisplay, ApplicableSwatchRow } from './ApplicableSwatch';
import type { SOAFieldSavePayload } from './soa-field-types';

export type {
  SOAFieldSavePayload,
  SOAProcessedResult,
  SOATableAnswerData,
} from './soa-field-types';

interface EditableSOAFieldsProps {
  documentId: string;
  questionId: string;
  isApplicable: boolean | null;
  justification: string | null;
  isPendingApproval: boolean;
  organizationId: string;
  /** Called after a successful save so the table can override autofill/cache without a full reload. */
  onUpdate?: (payload: SOAFieldSavePayload) => void;
}

export function EditableSOAFields({
  documentId,
  questionId,
  isApplicable: initialIsApplicable,
  justification: initialJustification,
  isPendingApproval,
  organizationId,
  onUpdate,
}: EditableSOAFieldsProps) {
  const t = useTranslations('isms');
  const { saveAnswer } = useSOADocument({ documentId, organizationId });
  const [isEditing, setIsEditing] = useState(false);
  const [isApplicable, setIsApplicable] = useState<boolean | null>(initialIsApplicable);
  const [justification, setJustification] = useState<string | null>(initialJustification);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const justificationTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [isJustificationDialogOpen, setJustificationDialogOpen] = useState(false);
  const dialogSavedRef = useRef(false);

  const [prevIsApplicable, setPrevIsApplicable] = useState(initialIsApplicable);
  const [prevJustificationProp, setPrevJustificationProp] = useState(initialJustification);
  if (prevIsApplicable !== initialIsApplicable || prevJustificationProp !== initialJustification) {
    setPrevIsApplicable(initialIsApplicable);
    setPrevJustificationProp(initialJustification);
    setIsApplicable(initialIsApplicable);
    setJustification(initialJustification);
  }

  // Editing is only locked while the document is pending approval. Physical-
  // security (7.x) controls on a fully remote org are auto-filled to Not
  // Applicable but stay editable — the org can move to a physical office at any
  // time, so answers are never locked.
  const isDisabled = isPendingApproval;

  // Auto-focus justification field when dialog opens
  useEffect(() => {
    if (isJustificationDialogOpen && justificationTextareaRef.current) {
      setTimeout(() => {
        justificationTextareaRef.current?.focus();
      }, 75);
    }
  }, [isJustificationDialogOpen]);

  const executeSave = async (
    nextIsApplicable: boolean | null,
    nextJustification: string | null,
  ): Promise<boolean> => {
    setIsSaving(true);
    try {
      await saveAnswer({
        questionId,
        answer: nextJustification,
        isApplicable: nextIsApplicable,
        justification: nextJustification,
      });

      // Update local state
      setIsApplicable(nextIsApplicable);
      setJustification(nextJustification);
      setIsEditing(false);
      setError(null);
      toast.success(t('soa.answerSaved'));
      onUpdate?.({
        isApplicable: nextIsApplicable,
        justification: nextJustification,
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : t('soa.saveFailed');
      if (!isJustificationDialogOpen) {
        setIsApplicable(initialIsApplicable);
        setJustification(initialJustification);
        setJustificationDialogOpen(false);
      }
      setError(message);
      toast.error(message);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const closeEditing = () => {
    setIsEditing(false);
    setIsApplicable(initialIsApplicable);
    setJustification(initialJustification);
    setError(null);
    setJustificationDialogOpen(false);
  };

  const handleEditClick = () => {
    setIsEditing(true);
  };

  const handleSelectChange = (value: string | null) => {
    if (value !== 'yes' && value !== 'no' && value !== 'null') {
      return;
    }

    const newValue = value === 'yes' ? true : value === 'no' ? false : null;
    setIsApplicable(newValue);
    setError(null);

    if (newValue === true || newValue === false) {
      setJustificationDialogOpen(true);
      return;
    }

    setJustificationDialogOpen(false);
    void executeSave(null, null);
  };

  const handleJustificationSave = async () => {
    if (isApplicable === false && (!justification || justification.trim().length === 0)) {
      setError(t('soa.justificationRequired'));
      justificationTextareaRef.current?.focus();
      return;
    }

    const success = await executeSave(isApplicable, justification);
    if (!success) {
      return;
    }
    dialogSavedRef.current = true;
    setJustificationDialogOpen(false);
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      if (dialogSavedRef.current) {
        dialogSavedRef.current = false;
      } else {
        setIsApplicable(initialIsApplicable);
        setJustification(initialJustification);
      }
      setError(null);
    }

    setJustificationDialogOpen(open);
  };

  if (isDisabled && !isEditing) {
    // Display mode
    return (
      <div className="flex w-full flex-col items-center gap-2 text-center">
        <ApplicableReadOnlyDisplay isApplicable={isApplicable} />
      </div>
    );
  }

  if (!isEditing) {
    return (
      <div className="group relative flex w-full items-center justify-center">
        <ApplicableReadOnlyDisplay isApplicable={isApplicable} />
        <button
          type="button"
          onClick={handleEditClick}
          className="absolute right-0 flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground opacity-100 shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('soa.editAnswer')}
          title={t('soa.editAnswer')}
        >
          <Edit size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="w-32">
          <Select
            value={isApplicable === null ? 'null' : isApplicable ? 'yes' : 'no'}
            onValueChange={handleSelectChange}
          >
            <SelectTrigger disabled={isSaving}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="null" disabled>
                <ApplicableSwatchRow isApplicable={null} />
              </SelectItem>
              <SelectItem value="yes">
                <ApplicableSwatchRow isApplicable />
              </SelectItem>
              <SelectItem value="no">
                <ApplicableSwatchRow isApplicable={false} />
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={closeEditing}
          disabled={isSaving}
          aria-label={t('soa.closeEditing')}
        >
          <Close size={12} />
          <span className="sr-only">{t('soa.closeEditing')}</span>
        </Button>
      </div>

      <Dialog open={isJustificationDialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isApplicable === false
                ? t('soa.justificationRequiredTitle')
                : t('soa.editJustificationTitle')}
            </DialogTitle>
            <DialogDescription>
              {isApplicable === false
                ? t('soa.justificationRequiredDescription')
                : t('soa.justificationDescription')}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            ref={justificationTextareaRef}
            value={justification || ''}
            onChange={(e) => {
              setJustification(e.target.value);
              setError(null);
            }}
            placeholder={
              isApplicable === false ? t('soa.placeholderRequired') : t('soa.placeholder')
            }
            rows={5}
            size="full"
            required={isApplicable === false}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => handleDialogOpenChange(false)}
              disabled={isSaving}
            >
              {t('soa.cancel')}
            </Button>
            <Button onClick={handleJustificationSave} loading={isSaving}>
              {isSaving ? t('soa.saving') : t('soa.saveJustification')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
