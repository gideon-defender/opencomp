import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import '../config/load-env';
import { EMAIL_SQS_QUEUE_URL, sqsClient } from '../email/aws';
import { emailMessageSchema, type EmailMessage } from '../email/email-message';
import { buildUnsubscribeHeaders } from './unsubscribe-headers';
import { resolveFromAddress } from '../email/from-address';
import { sendEmailViaSes } from '../email/ses-client';

const BATCH_SIZE = 10;
const VISIBILITY_TIMEOUT_SECONDS = 60;
const LONG_POLL_SECONDS = 20;
const BATCH_THROTTLE_MS = 1000;

let running = true;

function log(
  level: 'info' | 'warn' | 'error',
  message: string,
  meta?: unknown,
): void {
  const line = `[email-worker] ${new Date().toISOString()} [${level}] ${message}`;
  if (level === 'error') console.error(line, meta ?? '');
  else if (level === 'warn') console.warn(line, meta ?? '');
  else console.log(line, meta ?? '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processMessage(message: Message): Promise<void> {
  const parsed = emailMessageSchema.safeParse(JSON.parse(message.Body ?? '{}'));

  if (!parsed.success) {
    log(
      'warn',
      `Malformed email message ${message.MessageId ?? 'unknown'} — skipping and deleting`,
      parsed.error.flatten(),
    );
    return;
  }

  const email: EmailMessage = parsed.data;
  const fromAddress = email.from ?? resolveFromAddress(email.channel);

  if (!fromAddress) {
    throw new Error('Missing FROM address in environment variables');
  }

  const testRecipient = process.env.EMAIL_TO_TEST?.trim() || undefined;
  const replyTo =
    email.channel === 'marketing' &&
    process.env.EMAIL_REPLY_TO_MARKETING?.trim()
      ? process.env.EMAIL_REPLY_TO_MARKETING.trim()
      : undefined;

  const { id } = await sendEmailViaSes({
    to: testRecipient ?? email.to,
    from: fromAddress,
    subject: email.subject,
    html: email.html,
    cc: email.cc,
    replyTo,
    headers: buildUnsubscribeHeaders({
      to: email.to,
      userId: email.userId,
      organizationId: email.organizationId,
      apiBaseUrl:
        process.env.NEXT_PUBLIC_API_URL || 'https://api.gideondefender.com',
    }),
    attachments: email.attachments,
  });

  log(
    'info',
    `Email sent to ${testRecipient ?? email.to}${testRecipient ? ` (EMAIL_TO_TEST override of ${email.to})` : ''}`,
    { id, subject: email.subject },
  );
}

async function deleteMessage(message: Message): Promise<void> {
  if (!sqsClient || !message.ReceiptHandle) return;
  await sqsClient.send(
    new DeleteMessageCommand({
      QueueUrl: EMAIL_SQS_QUEUE_URL,
      ReceiptHandle: message.ReceiptHandle,
    }),
  );
}

async function poll(): Promise<void> {
  if (!sqsClient || !EMAIL_SQS_QUEUE_URL) {
    throw new Error(
      'Email worker not configured - missing AWS credentials, region, or EMAIL_SQS_QUEUE_URL',
    );
  }

  while (running) {
    try {
      const { Messages } = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: EMAIL_SQS_QUEUE_URL,
          MaxNumberOfMessages: BATCH_SIZE,
          WaitTimeSeconds: LONG_POLL_SECONDS,
          VisibilityTimeout: VISIBILITY_TIMEOUT_SECONDS,
        }),
      );

      const messages = Messages ?? [];
      if (messages.length === 0) continue;

      const results = await Promise.allSettled(messages.map(processMessage));
      const succeeded = messages.filter(
        (_, index) => results[index].status === 'fulfilled',
      );

      await Promise.all(succeeded.map(deleteMessage));

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          log(
            'error',
            `Failed to send email ${messages[index].MessageId ?? 'unknown'} — leaving in queue for retry`,
            result.reason instanceof Error
              ? result.reason.message
              : result.reason,
          );
        }
      });

      if (messages.length === BATCH_SIZE) {
        await sleep(BATCH_THROTTLE_MS);
      }
    } catch (error) {
      log(
        'error',
        'Poll loop error — backing off',
        error instanceof Error ? error.message : error,
      );
      await sleep(2000);
    }
  }
}

function shutdown(signal: string): void {
  log('info', `Received ${signal}, draining before exit`);
  running = false;
  setTimeout(() => process.exit(0), LONG_POLL_SECONDS * 1000 + 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

poll().catch((error) => {
  log(
    'error',
    'Email worker terminated',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
