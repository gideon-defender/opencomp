const sendMock = jest.fn();

jest.mock('./aws', () => ({
  EMAIL_SQS_QUEUE_URL: 'http://sqs.us-east-1/000000000000/comp-emails',
  sqsClient: { send: (...args: unknown[]) => sendMock(...args) },
}));

jest.mock('@aws-sdk/client-sqs', () => ({
  SendMessageCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ name: 'SendMessage', input })),
  SendMessageBatchCommand: jest.fn().mockImplementation((input: unknown) => ({
    name: 'SendMessageBatch',
    input,
  })),
}));

import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { enqueueEmail, enqueueEmailBatch } from './sqs-client';
import { z } from 'zod';
import {
  getUserUnsubscribeUrl,
  verifyUserUnsubscribeToken,
} from '@gideon-defender/email';

const message = {
  to: 'a@b.com',
  subject: 'Hi',
  html: '<p>hi</p>',
  channel: 'system' as const,
};

describe('enqueueEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('enqueues the message body as JSON and returns the MessageId', async () => {
    sendMock.mockResolvedValueOnce({ MessageId: 'msg-1' });

    const result = await enqueueEmail(message);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = (SendMessageCommand as unknown as jest.Mock).mock
      .calls[0][0];
    expect(command.QueueUrl).toBe(
      'http://sqs.us-east-1/000000000000/comp-emails',
    );
    expect(JSON.parse(command.MessageBody)).toEqual(message);
    expect(command.DelaySeconds).toBeUndefined();
    expect(result).toEqual({ id: 'msg-1' });
  });

  it('applies SQS DelaySeconds for a future scheduledAt', async () => {
    const future = new Date(Date.now() + 120_000).toISOString();
    sendMock.mockResolvedValueOnce({ MessageId: 'msg-2' });

    await enqueueEmail({ ...message, scheduledAt: future });

    const command = (SendMessageCommand as unknown as jest.Mock).mock
      .calls[0][0];
    expect(command.DelaySeconds).toBe(120);
  });

  it('queues the origin and signs the footer for the same tenant before a split', async () => {
    sendMock.mockResolvedValueOnce({ MessageId: 'scoped' });
    const userId = 'shared';
    const organizationId = 'secondary';
    const link = getUserUnsubscribeUrl({ userId, email: message.to });
    await enqueueEmail({
      ...message,
      userId,
      organizationId,
      html: `<a href="${link}">Preferences</a>`,
    });
    const body = jest.mocked(SendMessageCommand).mock.calls[0]?.[0].MessageBody;
    if (!body) throw new Error('No queued body');
    const queued = z
      .object({ html: z.string(), organizationId: z.string() })
      .parse(JSON.parse(body));
    expect(queued.organizationId).toBe(organizationId);
    const match = queued.html.match(/href="([^"]+)"/);
    if (!match?.[1]) throw new Error('No footer');
    const params = new URL(match[1].replaceAll('&amp;', '&')).searchParams;
    expect(params.get('organizationId')).toBe(organizationId);
    expect(
      verifyUserUnsubscribeToken({
        userId,
        organizationId,
        email: message.to,
        token: params.get('token') ?? '',
      }),
    ).toBe(true);
  });

  it('does not delay past SQS 900s cap and warns', async () => {
    const farFuture = new Date(Date.now() + 3600_000).toISOString();
    sendMock.mockResolvedValueOnce({ MessageId: 'msg-3' });

    await enqueueEmail({ ...message, scheduledAt: farFuture });

    const command = (SendMessageCommand as unknown as jest.Mock).mock
      .calls[0][0];
    expect(command.DelaySeconds).toBe(900);
    expect(console.warn).toHaveBeenCalled();
  });

  it('rejects messages over the SQS 256KB limit', async () => {
    await expect(
      enqueueEmail({ ...message, html: 'x'.repeat(300 * 1024) }),
    ).rejects.toThrow(/256KB/);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('enqueueEmailBatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('chunks into batches of 10 and returns the last MessageId', async () => {
    sendMock
      .mockResolvedValueOnce({
        Successful: Array.from({ length: 10 }, (_, i) => ({
          Id: `email-${i}`,
          MessageId: `msg-batch-${i}`,
        })),
      })
      .mockResolvedValueOnce({
        Successful: [{ Id: 'email-10', MessageId: 'msg-batch-10' }],
      });

    const emails = Array.from({ length: 11 }, (_, i) => ({
      ...message,
      to: `user-${i}@b.com`,
    }));

    const result = await enqueueEmailBatch(emails);

    expect(sendMock).toHaveBeenCalledTimes(2);
    const command = SendMessageCommand as unknown as jest.Mock;
    expect(command).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'msg-batch-10' });
  });

  it('throws when no message is accepted', async () => {
    sendMock.mockResolvedValueOnce({ Successful: [] });

    await expect(enqueueEmailBatch([message])).rejects.toThrow(
      /no successful messages/,
    );
  });
});
