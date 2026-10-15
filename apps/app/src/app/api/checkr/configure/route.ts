import { serverApi } from '@/lib/api-server';
import { hasPermission } from '@/lib/permissions';
import { requireApiPermission } from '@/lib/permissions.server';
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const ConfigureCheckrSchema = z.object({
  organizationId: z.string().trim().min(1).max(100),
  accountId: z.string().trim().min(1, 'Account ID is required').max(100),
  environment: z.enum(['sandbox', 'production']),
  package: z.string().trim().min(1, 'Package slug is required').max(100),
  node: z.string().trim().max(100).optional(),
  apiKey: z.string().trim().min(1, 'API key is required').max(500),
  enabled: z.boolean().optional().default(true),
});

type ConfigureCheckrInput = z.infer<typeof ConfigureCheckrSchema>;

const SecretWriteResponseSchema = z.object({
  secret: z.object({ id: z.string().min(1) }),
});

class UpstreamError extends Error {
  status: number;

  constructor({ message, status }: { message: string; status: number }) {
    super(message);
    this.status = status;
  }
}

function upstreamStatus(status: number): number {
  return status >= 400 ? status : 500;
}

async function createSecret({
  organizationId,
  name,
  apiKey,
}: {
  organizationId: string;
  name: string;
  apiKey: string;
}): Promise<{ id: string }> {
  const tenantHeaders = { 'X-Organization-Id': organizationId };
  const created = await serverApi.post<unknown>(
    '/v1/secrets',
    {
      name,
      value: apiKey,
      description: 'Checkr API key for tenant candidate intake.',
      category: 'checkr',
    },
    tenantHeaders,
  );
  const parsed = SecretWriteResponseSchema.safeParse(created.data);
  if (created.error || !parsed.success) {
    throw new UpstreamError({
      message: created.error ?? 'Could not store the Checkr API key.',
      status: upstreamStatus(created.status),
    });
  }
  return { id: parsed.data.secret.id };
}

async function deleteSecretBestEffort({
  organizationId,
  secretId,
}: {
  organizationId: string;
  secretId: string;
}): Promise<void> {
  const tenantHeaders = { 'X-Organization-Id': organizationId };
  try {
    await serverApi.delete(`/v1/secrets/${secretId}`, tenantHeaders);
  } catch {
    // Best-effort cleanup only. The main flow already decided its result.
  }
}

async function configureIntake({
  organizationId,
  input,
  apiKeySecretId,
}: {
  organizationId: string;
  input: ConfigureCheckrInput;
  apiKeySecretId: string;
}) {
  const tenantHeaders = { 'X-Organization-Id': organizationId };
  return serverApi.put(
    '/v1/people/candidate-screenings/connection',
    {
      accountId: input.accountId,
      apiKeySecretId,
      environment: input.environment,
      package: input.package,
      node: input.node || undefined,
      enabled: input.enabled,
    },
    tenantHeaders,
  );
}

/**
 * Bind the page tenant to the authenticated tenant before any writes.
 * Each attempt uses a separate secret. The API verifies it before changing
 * the connection reference; previous credentials remain intact for in-flight work.
 */
export async function POST(req: Request) {
  const ctx = await requireApiPermission(req, 'integration', 'update');
  if (ctx instanceof NextResponse) return ctx;
  if (
    !hasPermission(ctx.permissions, 'secret', 'create') ||
    !hasPermission(ctx.permissions, 'secret', 'delete')
  ) {
    return NextResponse.json(
      { error: 'Checkr configuration requires secret create and delete permissions.' },
      { status: 403 },
    );
  }
  const { organizationId } = ctx;

  const parsed = ConfigureCheckrSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid Checkr configuration.' }, { status: 400 });
  }
  if (parsed.data.organizationId !== organizationId) {
    return NextResponse.json(
      { error: 'Your active tenant changed. Reload this page before configuring Checkr.' },
      { status: 409 },
    );
  }

  try {
    const { id: secretId } = await createSecret({
      organizationId,
      name: `checkr-api-key-${randomUUID()}`,
      apiKey: parsed.data.apiKey,
    });
    const configured = await configureIntake({
      organizationId,
      input: parsed.data,
      apiKeySecretId: secretId,
    });
    if (configured.error || !configured.data) {
      // A timeout or server error can follow a committed connection update.
      // Only remove the proposed secret after a definitive request rejection.
      if (configured.status >= 400 && configured.status < 500 && configured.status !== 408) {
        await deleteSecretBestEffort({ organizationId, secretId });
      }
      return NextResponse.json(
        { error: configured.error ?? 'Checkr configuration was rejected.' },
        { status: upstreamStatus(configured.status) },
      );
    }
    return NextResponse.json({ connection: configured.data });
  } catch (error) {
    if (error instanceof UpstreamError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Checkr configuration failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
