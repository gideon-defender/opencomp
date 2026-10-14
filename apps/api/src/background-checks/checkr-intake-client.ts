import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { z } from 'zod';

export class CheckrIntakeRejected extends Error {}

const idSchema = z.object({ id: z.string().min(1) });

/** Separate from legacy member screening: hosted invitations only. */
export class CheckrIntakeClient {
  constructor(
    private readonly config: { apiKey: string; environment: string },
  ) {}

  private async request(params: {
    path: string;
    body?: unknown;
    key?: string;
  }) {
    const origin =
      this.config.environment === 'sandbox'
        ? 'https://api.checkr-staging.com'
        : 'https://api.checkr.com';
    let response: Response;
    try {
      response = await fetch(`${origin}/v1/${params.path}`, {
        method: params.body ? 'POST' : 'GET',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.apiKey}:`).toString('base64')}`,
          'Content-Type': 'application/json',
          ...(params.key ? { 'Idempotency-Key': params.key } : {}),
        },
        body: params.body ? JSON.stringify(params.body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      // A timed-out write may have succeeded. Retry the identical key.
      throw new ServiceUnavailableException(
        'Checkr request outcome is unavailable.',
      );
    }
    if (
      response.status === 409 ||
      response.status === 429 ||
      response.status >= 500
    ) {
      throw new ServiceUnavailableException('Checkr request needs recovery.');
    }
    if (!response.ok)
      throw new CheckrIntakeRejected('Checkr rejected the request.');
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new ServiceUnavailableException('Checkr response needs recovery.');
    }
  }

  async verifyAccount(accountId: string) {
    let raw: unknown;
    try {
      raw = await this.request({ path: 'account' });
    } catch (error) {
      // Credential/read failures cannot establish whether a prior timed-out
      // invitation succeeded, so they must never trigger an allowance refund.
      if (error instanceof CheckrIntakeRejected) {
        throw new BadRequestException(
          'Checkr account credentials are unavailable.',
        );
      }
      throw error;
    }
    const account = idSchema.safeParse(raw);
    if (!account.success || account.data.id !== accountId) {
      throw new BadRequestException(
        'Checkr credentials do not match the configured tenant account.',
      );
    }
  }

  async createCandidate(params: {
    email: string;
    firstName: string;
    lastName: string;
    key: string;
  }) {
    const result = idSchema.safeParse(
      await this.request({
        path: 'candidates',
        key: params.key,
        body: {
          email: params.email,
          first_name: params.firstName,
          last_name: params.lastName,
        },
      }),
    );
    if (!result.success)
      throw new ServiceUnavailableException('Checkr candidate needs recovery.');
    return result.data.id;
  }

  async invite(params: {
    candidateId: string;
    package: string;
    key: string;
    node: string | null;
    country: string;
    state: string | null;
    city: string | null;
  }) {
    const result = idSchema.safeParse(
      await this.request({
        path: 'invitations',
        key: params.key,
        body: {
          candidate_id: params.candidateId,
          package: params.package,
          ...(params.node ? { node: params.node } : {}),
          work_locations: [
            {
              country: params.country,
              state: params.state ?? undefined,
              city: params.city ?? undefined,
            },
          ],
        },
      }),
    );
    if (!result.success)
      throw new ServiceUnavailableException(
        'Checkr invitation needs recovery.',
      );
    return result.data.id;
  }
}
