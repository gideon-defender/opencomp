import { useRevokeAccessGrant } from '@/hooks/use-access-requests';
import { usePermissions } from '@/hooks/use-permissions';
import { Button } from '@gideon-defender/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gideon-defender/ui/dialog';
import { Field, FieldError, FieldLabel } from '@gideon-defender/ui/field';
import { Textarea } from '@gideon-defender/ui/textarea';
import { useForm } from '@tanstack/react-form';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import * as z from 'zod';

export function RevokeDialog({
  orgId,
  grantId,
  onClose,
}: {
  orgId: string;
  grantId: string;
  onClose: () => void;
}) {
  const t = useTranslations('trust');
  const tt = useTranslations('toasts');
  const tv = useTranslations('validation');
  const { hasPermission } = usePermissions();
  const canUpdate = hasPermission('trust', 'update');
  const { mutateAsync: revokeGrant } = useRevokeAccessGrant(orgId);

  const form = useForm({
    defaultValues: {
      reason: '',
    },
    validators: {
      onChange: z.object({
        reason: z.string().min(1, { message: tv('reasonRequired') }),
      }),
    },
    onSubmit: async ({ value }) => {
      await toast.promise(revokeGrant({ grantId, reason: value.reason }), {
        loading: tt('revoking'),
        success: () => {
          onClose();
          return tt('grantRevoked');
        },
        error: tt('grantRevokeFailed'),
      });
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
          className="flex flex-col gap-1"
        >
          <DialogHeader>
            <DialogTitle>{t('revoke.title')}</DialogTitle>
            <DialogDescription>{t('revoke.description')}</DialogDescription>
          </DialogHeader>
          <form.Field name="reason">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor="reason">{t('revoke.reasonLabel')}</FieldLabel>
                  <Textarea
                    id="reason"
                    name={field.name}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    aria-invalid={isInvalid}
                    placeholder={t('revoke.reasonPlaceholder')}
                    rows={4}
                    className="resize-none"
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>
          <DialogFooter className="gap-1">
            <Button variant="outline" onClick={onClose} type="button">
              {t('revoke.cancel')}
            </Button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button
                  variant="destructive"
                  type="submit"
                  disabled={!canSubmit || isSubmitting || !canUpdate}
                >
                  {isSubmitting ? t('revoke.revoking') : t('revoke.revokeGrant')}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
