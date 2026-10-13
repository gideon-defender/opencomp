import { z } from 'zod';

export const emailChannelSchema = z.enum([
  'marketing',
  'system',
  'trustPortal',
  'default',
]);
export type EmailChannel = z.infer<typeof emailChannelSchema>;

export const emailAttachmentSchema = z.object({
  filename: z.string(),
  content: z.string(),
  contentType: z.string().optional(),
});
export type EmailAttachment = z.infer<typeof emailAttachmentSchema>;

export const emailMessageSchema = z.object({
  to: z.string(),
  subject: z.string(),
  html: z.string(),
  channel: emailChannelSchema.optional(),
  from: z.string().optional(),
  cc: z.union([z.string(), z.array(z.string())]).optional(),
  scheduledAt: z.string().optional(),
  attachments: z.array(emailAttachmentSchema).optional(),
  // Recipient user id for a tenant-scoped one-click unsubscribe URL. When
  // present the worker mints a user-bound token so Gmail Unsubscribe hits
  // exactly one tenant account; without it the legacy email-only link is
  // used, which no-ops (by design) when several tenants share the address.
  userId: z.string().optional(),
  organizationId: z.string().optional(),
});
export type EmailMessage = z.infer<typeof emailMessageSchema>;
