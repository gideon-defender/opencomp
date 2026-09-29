'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FileCheck, KeyRound, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { publicApiBase } from '@/lib/api';

const requestAccessSchema = z.object({
  name: z.string().trim().min(1, 'Full name is required').max(100),
  email: z.email('Enter a valid work email'),
  company: z.string().trim().max(200).optional(),
  jobTitle: z.string().trim().max(200).optional(),
  purpose: z.string().trim().max(2000).optional(),
});

type RequestAccessForm = z.infer<typeof requestAccessSchema>;

const inputClassName =
  'min-h-10 w-full rounded-md border border-line bg-white px-3 text-[15px] outline-none transition-colors placeholder:text-muted focus:border-primary';

const errorClassName = 'mt-1 text-[13px] text-danger';

/**
 * Hero action buttons + request-access dialog. The security questionnaire
 * requires approved access, so both entries open the request form — the
 * questionnaire one presets the purpose.
 */
export function RequestAccessActions({
  friendlyUrl,
  organizationName,
  questionnaireAvailable,
}: {
  friendlyUrl: string;
  organizationName: string;
  questionnaireAvailable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RequestAccessForm>({
    resolver: zodResolver(requestAccessSchema),
    defaultValues: { name: '', email: '', company: '', jobTitle: '', purpose: '' },
  });

  function handleOpen(purpose: string) {
    reset({ name: '', email: '', company: '', jobTitle: '', purpose });
    setOpen(true);
  }

  async function handleRequestAccess(data: RequestAccessForm) {
    let apiBase: string;
    try {
      apiBase = publicApiBase();
    } catch {
      toast.error('Could not send the request — try again later');
      return;
    }
    let response: Response;
    try {
      response = await fetch(
        `${apiBase}/v1/trust-access/${encodeURIComponent(friendlyUrl)}/requests`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.name,
            email: data.email,
            company: data.company || undefined,
            jobTitle: data.jobTitle || undefined,
            purpose: data.purpose || undefined,
          }),
        },
      );
    } catch {
      toast.error('Could not send the request — try again later');
      return;
    }
    if (!response.ok) {
      const serverMessage = await response
        .json()
        .then((body: unknown) => {
          if (typeof body === 'object' && body !== null && 'message' in body) {
            const message = (body as { message?: unknown }).message;
            if (typeof message === 'string' && message) return message;
            if (Array.isArray(message)) {
              const first = message.find((item): item is string => typeof item === 'string');
              if (first) return first;
            }
          }
          return null;
        })
        .catch(() => null);
      toast.error(serverMessage ?? 'Could not send the request — try again later');
      return;
    }
    toast.success('Access request sent');
    setOpen(false);
  }

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
        {questionnaireAvailable && (
          <button
            type="button"
            onClick={() => handleOpen('Security questionnaire')}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold transition-colors hover:border-muted"
          >
            <FileCheck size={16} aria-hidden="true" />
            Security questionnaire
          </button>
        )}
        <button
          type="button"
          onClick={() => handleOpen('')}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          <KeyRound size={16} aria-hidden="true" />
          Request access
        </button>
      </div>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Request access to ${organizationName}`}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close dialog"
              className="absolute top-4 right-4 inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-muted transition-colors hover:bg-canvas hover:text-ink"
            >
              <X size={18} aria-hidden="true" />
            </button>
            <h2 className="text-[22px] font-semibold">Request access</h2>
            <p className="mt-1 text-sm text-muted">
              Ask {organizationName} for access to gated trust documents.
            </p>
            <form
              onSubmit={handleSubmit(handleRequestAccess)}
              noValidate
              className="mt-4 space-y-4"
            >
              <div>
                <label htmlFor="tc-name" className="mb-1 block text-[13px] font-semibold">
                  Full name
                </label>
                <input
                  id="tc-name"
                  placeholder="Ada Lovelace"
                  autoComplete="name"
                  className={inputClassName}
                  {...register('name')}
                />
                {errors.name && <p className={errorClassName}>{errors.name.message}</p>}
              </div>
              <div>
                <label htmlFor="tc-email" className="mb-1 block text-[13px] font-semibold">
                  Work email
                </label>
                <input
                  id="tc-email"
                  placeholder="ada@company.com"
                  type="email"
                  autoComplete="email"
                  className={inputClassName}
                  {...register('email')}
                />
                {errors.email && <p className={errorClassName}>{errors.email.message}</p>}
              </div>
              <div>
                <label htmlFor="tc-company" className="mb-1 block text-[13px] font-semibold">
                  Company <span className="font-normal text-muted">(optional)</span>
                </label>
                <input
                  id="tc-company"
                  placeholder="Company"
                  autoComplete="organization"
                  className={inputClassName}
                  {...register('company')}
                />
                {errors.company && <p className={errorClassName}>{errors.company.message}</p>}
              </div>
              <div>
                <label htmlFor="tc-job" className="mb-1 block text-[13px] font-semibold">
                  Job title <span className="font-normal text-muted">(optional)</span>
                </label>
                <input
                  id="tc-job"
                  placeholder="Security engineer"
                  className={inputClassName}
                  {...register('jobTitle')}
                />
                {errors.jobTitle && <p className={errorClassName}>{errors.jobTitle.message}</p>}
              </div>
              <div>
                <label htmlFor="tc-purpose" className="mb-1 block text-[13px] font-semibold">
                  Purpose <span className="font-normal text-muted">(optional)</span>
                </label>
                <textarea
                  id="tc-purpose"
                  placeholder="What do you need access for?"
                  rows={3}
                  className="min-h-[112px] w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-[15px] outline-none transition-colors placeholder:text-muted focus:border-primary"
                  {...register('purpose')}
                />
                {errors.purpose && <p className={errorClassName}>{errors.purpose.message}</p>}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex min-h-10 items-center rounded-md border border-line px-4 text-sm font-semibold transition-colors hover:border-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? 'Sending…' : 'Send request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
