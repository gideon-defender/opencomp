import {
  SendMessageBatchCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { EMAIL_SQS_QUEUE_URL, sqsClient } from './aws';
import { scopeUnsubscribeLinks } from '@gideon-defender/email';
import type { EmailMessage } from './email-message';

const SQS_MESSAGE_SIZE_LIMIT = 256 * 1024;
const SQS_MAX_DELAY_SECONDS = 900;
const SQS_BATCH_LIMIT = 10;

function computeDelaySeconds(scheduledAt?: string): number | undefined {
  if (!scheduledAt) return undefined;
  const delayMs = new Date(scheduledAt).getTime() - Date.now();
  if (delayMs <= 0) return undefined;

  const seconds = Math.ceil(delayMs / 1000);
  if (seconds > SQS_MAX_DELAY_SECONDS) {
    console.warn(
      `[enqueueEmail] scheduledAt is ${seconds}s in the future; SQS delays are capped at ${SQS_MAX_DELAY_SECONDS}s. The email will be sent early.`,
    );
    return SQS_MAX_DELAY_SECONDS;
  }
  return seconds;
}

function assertQueueConfigured(): void {
  if (!sqsClient) {
    throw new Error(
      'Email queue not configured - missing AWS credentials or region',
    );
  }
  if (!EMAIL_SQS_QUEUE_URL) {
    throw new Error('Email queue not configured - missing EMAIL_SQS_QUEUE_URL');
  }
}

function assertMessageSize(message: EmailMessage): void {
  const size = Buffer.byteLength(JSON.stringify(message), 'utf8');
  if (size > SQS_MESSAGE_SIZE_LIMIT) {
    throw new Error(
      `Email message (${size} bytes) exceeds the SQS 256KB limit. Large attachments should be uploaded to S3 and referenced by key.`,
    );
  }
}

export async function enqueueEmail(
  message: EmailMessage,
): Promise<{ id: string }> {
  assertQueueConfigured();
  message = {
    ...message,
    html: scopeUnsubscribeLinks({ ...message, email: message.to }),
  };
  assertMessageSize(message);

  const delaySeconds = computeDelaySeconds(message.scheduledAt);

  const { MessageId } = await sqsClient!.send(
    new SendMessageCommand({
      QueueUrl: EMAIL_SQS_QUEUE_URL,
      MessageBody: JSON.stringify(message),
      ...(delaySeconds ? { DelaySeconds: delaySeconds } : {}),
    }),
  );

  if (!MessageId) {
    throw new Error('SQS SendMessage succeeded but returned no MessageId');
  }

  return { id: MessageId };
}

export async function enqueueEmailBatch(
  messages: EmailMessage[],
): Promise<{ id: string }> {
  assertQueueConfigured();
  messages = messages.map((message) => ({
    ...message,
    html: scopeUnsubscribeLinks({ ...message, email: message.to }),
  }));
  messages.forEach(assertMessageSize);

  let lastId: string | undefined;

  for (let i = 0; i < messages.length; i += SQS_BATCH_LIMIT) {
    const chunk = messages.slice(i, i + SQS_BATCH_LIMIT);
    const { Successful } = await sqsClient!.send(
      new SendMessageBatchCommand({
        QueueUrl: EMAIL_SQS_QUEUE_URL,
        Entries: chunk.map((message, index) => {
          const delaySeconds = computeDelaySeconds(message.scheduledAt);
          return {
            Id: `email-${i + index}`,
            MessageBody: JSON.stringify(message),
            ...(delaySeconds ? { DelaySeconds: delaySeconds } : {}),
          };
        }),
      }),
    );

    const sent = Successful ?? [];
    if (sent.length !== chunk.length) {
      console.warn(
        `[enqueueEmailBatch] ${chunk.length - sent.length} of ${chunk.length} messages were not accepted by SQS`,
      );
    }
    lastId = sent[sent.length - 1]?.MessageId;
  }

  if (!lastId) {
    throw new Error('SQS SendMessageBatch returned no successful messages');
  }

  return { id: lastId };
}
