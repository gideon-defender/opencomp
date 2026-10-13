import { render } from '@react-email/render';
import type { ReactElement } from 'react';
import type { EmailChannel } from './email-message';
import { enqueueEmail } from './sqs-client';

type TriggerEmailFlags = {
  marketing?: boolean;
  system?: boolean;
  trustPortal?: boolean;
};

function resolveChannel(flags: TriggerEmailFlags): EmailChannel {
  if (flags.trustPortal) return 'trustPortal';
  if (flags.marketing) return 'marketing';
  if (flags.system) return 'system';
  return 'default';
}

type EmailAttachmentInput = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};

export async function triggerEmail(params: {
  to: string;
  subject: string;
  react: ReactElement;
  marketing?: boolean;
  system?: boolean;
  trustPortal?: boolean;
  cc?: string | string[];
  scheduledAt?: string;
  attachments?: EmailAttachmentInput[];
  /** Recipient user id for a tenant-scoped one-click unsubscribe URL. */
  userId?: string;
  organizationId?: string;
}): Promise<{ id: string }> {
  try {
    const html = await render(params.react);

    const channel = resolveChannel(params);

    const { id } = await enqueueEmail({
      to: params.to,
      subject: params.subject,
      html,
      channel,
      cc: params.cc,
      scheduledAt: params.scheduledAt,
      userId: params.userId,
      organizationId: params.organizationId,
      attachments: params.attachments?.map((att) => ({
        filename: att.filename,
        content:
          typeof att.content === 'string'
            ? att.content
            : att.content.toString('base64'),
        contentType: att.contentType,
      })),
    });

    return { id };
  } catch (error) {
    console.error('[triggerEmail] Failed to enqueue email', {
      to: params.to,
      subject: params.subject,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
