import { BadRequestException } from '@nestjs/common';

const allowedHosts = new Set([
  'localhost',
  '127.0.0.1',
  'app.gideondefender.com',
  'app.staging.gideondefender.com',
  'opencomp.dev.gideondefender.com',
]);
const localDevelopmentHosts = new Set(['localhost', '127.0.0.1']);

export function validateBillingRedirectUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException('Billing redirect URL is invalid.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new BadRequestException('Billing redirect URL is invalid.');
  }

  if (!allowedHosts.has(url.hostname)) {
    throw new BadRequestException('Billing redirect URL is not allowed.');
  }

  if (url.protocol === 'http:' && !localDevelopmentHosts.has(url.hostname)) {
    throw new BadRequestException('Billing redirect URL must use HTTPS.');
  }
}
