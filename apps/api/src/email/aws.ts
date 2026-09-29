import { SESClient } from '@aws-sdk/client-ses';
import { SQSClient } from '@aws-sdk/client-sqs';
import { Logger } from '@nestjs/common';
import '../config/load-env';

const logger = new Logger('EmailAws');

const EMAIL_AWS_REGION = process.env.APP_AWS_REGION;
const EMAIL_AWS_ACCESS_KEY_ID = process.env.APP_AWS_ACCESS_KEY_ID;
const EMAIL_AWS_SECRET_ACCESS_KEY = process.env.APP_AWS_SECRET_ACCESS_KEY;
const EMAIL_AWS_ENDPOINT = process.env.APP_AWS_ENDPOINT;

const hasCredentials =
  !!EMAIL_AWS_ACCESS_KEY_ID &&
  !!EMAIL_AWS_SECRET_ACCESS_KEY &&
  !!EMAIL_AWS_REGION;

if (!hasCredentials) {
  logger.warn(
    '[EmailAws] AWS credentials or region missing. Email queueing and delivery will be unavailable until configured.',
  );
}

export const EMAIL_SQS_QUEUE_URL = process.env.EMAIL_SQS_QUEUE_URL;

if (hasCredentials && !EMAIL_SQS_QUEUE_URL) {
  logger.warn(
    '[EmailAws] EMAIL_SQS_QUEUE_URL is not set. Emails will not be queued.',
  );
}

let sqsClientInstance: SQSClient | null = null;
let sesClientInstance: SESClient | null = null;

if (hasCredentials) {
  const clientConfig = {
    region: EMAIL_AWS_REGION,
    credentials: {
      accessKeyId: EMAIL_AWS_ACCESS_KEY_ID,
      secretAccessKey: EMAIL_AWS_SECRET_ACCESS_KEY,
    },
    endpoint: EMAIL_AWS_ENDPOINT || undefined,
  };

  sqsClientInstance = new SQSClient(clientConfig);
  sesClientInstance = new SESClient(clientConfig);
}

export const sqsClient = sqsClientInstance;
export const sesClient = sesClientInstance;
