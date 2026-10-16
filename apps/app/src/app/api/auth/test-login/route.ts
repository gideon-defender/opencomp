import { db, Departments } from '@db/server';
import { NextRequest, NextResponse } from 'next/server';
import { createHmac, randomBytes } from 'node:crypto';

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';

// This endpoint is ONLY for E2E tests - never enable in production!
// It mints a user + organization + session directly in the database.
// No better-auth involved: Gideon OIDC is the only login, and E2E tests
// must not depend on the email+password path.
export async function POST(request: NextRequest) {
  // SECONDARY GUARD: Block in production even if E2E_TEST_MODE is accidentally set
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  // Only allow in E2E test mode
  if (process.env.E2E_TEST_MODE !== 'true') {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  }

  // Add a timeout wrapper
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Operation timed out after 30 seconds')), 30000);
  });

  try {
    const result = await Promise.race([handleLogin(request), timeoutPromise]);
    return result as NextResponse;
  } catch (error) {
    console.error('[TEST-LOGIN] Error in POST handler:', error);
    return NextResponse.json(
      { error: 'Failed to create test session', details: String(error) },
      { status: 500 },
    );
  }
}

async function handleLogin(request: NextRequest) {
  let body: {
    email?: string;
    name?: string;
    hasAccess?: boolean;
    skipOrg?: boolean;
    oidcTenantId?: string;
  };
  try {
    body = await request.json();
  } catch (err) {
    console.error('[TEST-LOGIN] Failed to parse request body:', err);
    return NextResponse.json(
      { error: 'Invalid request body', details: String(err) },
      { status: 400 },
    );
  }

  const email = body.email ?? `test-e2e-${Date.now()}@example.com`;
  const name = body.name ?? `Test User ${Date.now()}`;
  // Tenant is the org: test orgs are created under an explicit test tid.
  const tenantId = body.oidcTenantId ?? `tid_test_${Date.now()}`;

  const secret = process.env.SECRET_KEY;
  if (!secret) {
    console.error('[TEST-LOGIN] SECRET_KEY is not set');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  // For E2E tests, always start with a clean user state (tenant-scoped:
  // only this test tenant's account is removed, never another tenant's
  // same-email account).
  const normalizedTestEmail = email.trim().toLowerCase();
  try {
    await db.user.deleteMany({
      where: { tenantId, email: { equals: normalizedTestEmail, mode: 'insensitive' } },
    });
  } catch (err) {
    console.error('[TEST-LOGIN] Error deleting existing user:', err);
    return NextResponse.json(
      { error: 'Failed to delete existing user', details: String(err) },
      { status: 500 },
    );
  }

  let user;
  try {
    user = await db.user.create({
      data: {
        email: normalizedTestEmail,
        name,
        emailVerified: true,
        tenantId,
        oidcTenantId: tenantId,
      },
    });
  } catch (err) {
    console.error('[TEST-LOGIN] Error creating user:', err);
    return NextResponse.json(
      { error: 'Failed to create user', details: String(err) },
      { status: 500 },
    );
  }

  // Create an organization for the user if skipOrg is not true.
  // The session is minted with this org already active, so no separate
  // set-active step is needed.
  let org = null;
  if (!body.skipOrg) {
    try {
      org = await db.organization.create({
        data: {
          // Tenant is the org: the test tid is the primary key.
          id: tenantId,
          name: `Test Org ${Date.now()}`,
          hasAccess: body.hasAccess || false, // Allow setting hasAccess for tests
          members: {
            create: {
              userId: user.id,
              role: 'owner',
              department: Departments.it,
              isActive: true,
              fleetDmLabelId: 0,
            },
          },
        },
      });
    } catch (err) {
      console.error('[TEST-LOGIN] Error creating organization:', err);
      return NextResponse.json(
        { error: 'Failed to create organization', details: String(err) },
        { status: 500 },
      );
    }
  }

  let session;
  try {
    session = await db.session.create({
      data: {
        token: randomBytes(32).toString('hex'),
        userId: user.id,
        activeOrganizationId: org?.id ?? null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  } catch (err) {
    console.error('[TEST-LOGIN] Error creating session:', err);
    return NextResponse.json(
      { error: 'Failed to create session', details: String(err) },
      { status: 500 },
    );
  }

  const response = NextResponse.json({
    success: true,
    user: { id: user.id, email: user.email, name: user.name },
    session: {
      id: session.id,
      token: session.token,
      userId: session.userId,
      activeOrganizationId: session.activeOrganizationId,
      expiresAt: session.expiresAt,
    },
    organizationId: body.skipOrg ? null : org?.id,
  });

  // Sign the session cookie exactly like the API's session signer
  // (HMAC-SHA-256 over the raw token, same SECRET_KEY): the API verifies
  // this signature when the browser sends the cookie back. E2E runs on
  // plain-HTTP localhost, so the cookie mirrors the API's local attributes
  // (name `local.session_token`, lax, non-secure, host-only).
  const signature = createHmac('sha256', secret).update(session.token, 'utf8').digest('base64');
  response.cookies.set('local.session_token', `${session.token}.${signature}`, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: false,
    maxAge: 7 * 24 * 60 * 60,
  });

  return response;
}
