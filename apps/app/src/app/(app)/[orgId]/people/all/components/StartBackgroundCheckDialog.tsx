'use client';

import { apiClient } from '@/lib/api-client';
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@gideon-defender/ui/form';
import { Input } from '@gideon-defender/ui/input';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useRef } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import useSWR, { mutate } from 'swr';
import { z } from 'zod';

const schema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required').max(100),
    lastName: z.string().trim().min(1, 'Last name is required').max(100),
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((email) => email.toLowerCase()),
    country: z.string().regex(/^[A-Z]{2}$/, 'Use a two-letter country code'),
    state: z.string().max(2),
    city: z.string().trim().max(100),
  })
  .superRefine((values, context) => {
    if ((values.country === 'US' || values.state) && !/^[A-Z]{2}$/.test(values.state)) {
      context.addIssue({ code: 'custom', path: ['state'], message: 'Use a two-letter work state' });
    }
  });

const defaults = { firstName: '', lastName: '', email: '', country: 'US', state: '', city: '' };
const fields = [
  { name: 'firstName', label: 'First name' },
  { name: 'lastName', label: 'Last name' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'country', label: 'Work country (two-letter code)' },
  { name: 'state', label: 'Work state (required for US)' },
  { name: 'city', label: 'Work city' },
] as const;

export function StartBackgroundCheckDialog({
  open,
  onOpenChange,
  organizationId,
  canStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  canStart: boolean;
}) {
  const operationId = useRef<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });
  const { data: readiness, error: readinessError } = useSWR(
    open && canStart ? ['/v1/people/candidate-screenings/readiness', organizationId] : null,
    async ([endpoint, orgId]: [string, string]) => {
      const result = await apiClient.get<{ ready: boolean; message?: string }>(endpoint, orgId);
      if (result.error || !result.data) throw new Error('Could not check intake readiness.');
      return result.data;
    },
  );

  const handleSubmit = async (values: z.infer<typeof schema>) => {
    if (!canStart || !readiness?.ready) return;
    operationId.current ??= crypto.randomUUID();
    try {
      const result = await apiClient.post<{ runId: string; status: string }>(
        '/v1/people/candidate-screenings',
        {
          ...values,
          state: values.state || undefined,
          city: values.city || undefined,
          operationId: operationId.current,
        },
        organizationId,
      );
      if (result.error || !result.data?.runId) {
        toast.error(
          result.error ??
            'Screening submission could not be confirmed. Retry with the same details.',
        );
        return;
      }
      operationId.current = null;
      form.reset(defaults);
      void mutate(['/v1/people/candidate-screenings', organizationId]);
      toast.success(
        'Screening queued. Checkr will email the candidate its hosted background check link.',
      );
      onOpenChange(false);
    } catch {
      toast.error('Screening submission could not be confirmed. Retry with the same details.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Start background check</DialogTitle>
          <DialogDescription>
            Checkr will email the candidate a link to complete their screening on Checkr. Each
            screening uses one background-check allowance or credit. This does not create an account
            or grant access. Access and roles are managed in Gideon.
          </DialogDescription>
        </DialogHeader>
        {!canStart && <p role="alert">You do not have permission to start background checks.</p>}
        {canStart && !readiness?.ready && (
          <p role="status" className="text-muted-foreground text-sm">
            {readinessError
              ? 'Could not check Checkr readiness. Try again later.'
              : (readiness?.message ?? 'Checking Checkr availability…')}
          </p>
        )}
        <Form {...form}>
          <form
            onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              {fields.map((input) => (
                <FormField
                  key={input.name}
                  control={form.control}
                  name={input.name}
                  render={({ field }) => (
                    <FormItem className={input.name === 'email' ? 'col-span-2' : undefined}>
                      <FormLabel>{input.label}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type={input.name === 'email' ? 'email' : 'text'}
                          disabled={!canStart || !readiness?.ready || form.formState.isSubmitting}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={form.formState.isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!canStart || !readiness?.ready || form.formState.isSubmitting}
              >
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Start background check
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
