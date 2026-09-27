import type { Role } from '@db';
import { z } from 'zod';

export const ALL_SELECTABLE_ROLES: Role[] = ['admin', 'auditor', 'employee', 'contractor'];

/**
 * Translated validation strings for the invite form. Callers pass
 * `useTranslations('people')` / `useTranslations('validation')` results so
 * zod errors render in the active locale (zod schemas run client-side).
 */
export interface InviteValidationMessages {
  invalidEmail: string;
  selectAtLeastOneRole: string;
  addAtLeastOneInvite: string;
  selectSingleCSV: string;
}

export function createManualInviteSchema(messages: InviteValidationMessages) {
  return z.object({
    email: z.string().email({ message: messages.invalidEmail }),
    roles: z.array(z.string()).min(1, { message: messages.selectAtLeastOneRole }),
  });
}

export function createInviteFormSchema(messages: InviteValidationMessages) {
  const manualInviteSchema = createManualInviteSchema(messages);

  return z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('manual'),
      manualInvites: z.array(manualInviteSchema).min(1, {
        message: messages.addAtLeastOneInvite,
      }),
      csvFile: z.any().optional(),
    }),
    z.object({
      mode: z.literal('csv'),
      manualInvites: z.array(manualInviteSchema).optional(),
      csvFile: z.any().refine((val) => val instanceof FileList && val.length === 1, {
        message: messages.selectSingleCSV,
      }),
    }),
  ]);
}

export type InviteFormData = z.infer<ReturnType<typeof createInviteFormSchema>>;

export interface InviteResult {
  email: string;
  success: boolean;
  error?: string;
}
