import '../config/load-env';
import {
  ChangeEmailConfirmationEmail,
  VerifyEmail,
} from '@gideon-defender/email';
import { triggerEmail } from '../email/trigger-email';
import { serviceDb } from '@db';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { bearer, mcp, multiSession, organization } from 'better-auth/plugins';
import { ac, allRoles } from '@gideon-defender/auth';
import { GoneException } from '@nestjs/common';
import { getBetterAuthTrustedOrigins } from './origin-policy';
import { getCookieDomain } from './session-cookie';
import { authDatabaseHooks } from './auth-database-hooks';
import { idpOrganizationAccessPlugin } from './idp-organization-access-plugin';

export {
  getBetterAuthTrustedOrigins,
  getCompExtensionTrustedOrigins,
  getTrustedOrigins,
  isChromeExtensionOrigin,
  isCompExtensionAllowedRoute,
  isCompExtensionOrigin,
  isCompExtensionOriginAllowedForRequest,
  isStaticTrustedOrigin,
  isStaticTrustedOriginForRequest,
} from './origin-policy';

export { isTrustedOrigin } from './auth-custom-origins';

// Gideon is the sole authenticator. Legacy better-auth login entry points
// (Google/GitHub/Microsoft social, magic link, email OTP) were removed after
// OIDC cutover — the remaining plugins below serve session/org/MCP
// routes consumed by the frontends until their native replacements land.
const cookieDomain = getCookieDomain();

// ── Hosted MCP (Speakeasy Gram) OAuth ────────────────────────────────────────
// The MCP server is hosted on Gram. Gram obtains an OAuth access token from this
// API (better-auth as the authorization server) so users authenticate with
// "Sign in with Google" instead of pasting an API key.
//
// Gram's OAuth Proxy registers as a single static client and handles Dynamic
// Client Registration toward MCP clients on our behalf — so we keep public DCR
// off for now and register Gram as a trusted client. Configured via env so the
// secret isn't committed and the plugin is inert in envs where hosted MCP isn't
// set up yet.
const gramMcpClient =
  process.env.GRAM_OAUTH_CLIENT_ID &&
  process.env.GRAM_OAUTH_CLIENT_SECRET &&
  process.env.GRAM_OAUTH_REDIRECT_URI
    ? {
        clientId: process.env.GRAM_OAUTH_CLIENT_ID,
        clientSecret: process.env.GRAM_OAUTH_CLIENT_SECRET,
        name: 'OpenComp MCP (Gram)',
        type: 'web' as const,
        disabled: false,
        redirectUrls: [process.env.GRAM_OAUTH_REDIRECT_URI],
        metadata: null,
        // First-party client: Gram is OpenComp's own hosted MCP, so the user's
        // login (Sign in with Google) IS the authorization — no separate consent
        // screen is needed. This also avoids having to build a consent page UI.
        skipConsent: true,
      }
    : null;

// Where better-auth sends the user to authenticate during the OAuth flow.
// Must point at the app's sign-in page. Override per environment via env.
const mcpLoginPage =
  process.env.MCP_OAUTH_LOGIN_PAGE ||
  `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.gideondefender.com'}/auth`;

// =============================================================================
// Security Validation
// =============================================================================

/**
 * Validate required environment variables at startup.
 * Throws an error if critical security configuration is missing.
 */
function validateSecurityConfig(): void {
  if (!process.env.SECRET_KEY) {
    throw new Error(
      'SECURITY ERROR: SECRET_KEY environment variable is required. ' +
        'Generate a secure secret with: openssl rand -base64 32',
    );
  }

  if (process.env.SECRET_KEY.length < 16) {
    throw new Error(
      'SECURITY ERROR: SECRET_KEY must be at least 16 characters long for security.',
    );
  }

  // Warn about development defaults in production
  if (process.env.NODE_ENV === 'production') {
    const baseUrl = process.env.BASE_URL || '';
    if (baseUrl.includes('localhost')) {
      console.warn(
        'SECURITY WARNING: BASE_URL contains "localhost" in production. ' +
          'This may cause issues with OAuth callbacks and cookies.',
      );
    }
  }
}

// Run validation at module load time
validateSecurityConfig();

/**
 * The auth server instance - single source of truth for authentication.
 *
 * BASE_URL must point to the API (e.g., https://api.gideondefender.com).
 * OAuth callbacks go directly to the API. Clients send absolute callbackURLs
 * so better-auth redirects to the correct app after processing.
 * Cross-subdomain cookies (.gideondefender.com) ensure the session works on all apps.
 */
export const auth = betterAuth({
  // better-auth (sessions, members, org plugin, OAuth) runs as the service
  // role (BYPASSRLS) so auth flow never needs a tenant context. When
  // DATABASE_URL_SERVICE is unset this falls back to DATABASE_URL (no change).
  database: prismaAdapter(serviceDb, {
    provider: 'postgresql',
  }),
  // baseURL must point to the API (e.g., https://api.gideondefender.com) so that
  // OAuth callbacks go directly to the API regardless of which frontend
  // initiated the flow. Clients must send absolute callbackURLs so that
  // after OAuth processing, better-auth redirects to the correct app.
  // Cross-subdomain cookies (.gideondefender.com) ensure the session works everywhere.
  baseURL: process.env.BASE_URL || 'http://localhost:3333',
  trustedOrigins: getBetterAuthTrustedOrigins(),
  emailAndPassword: {
    // Not used — Gideon OIDC is the sole login; email change still uses
    // the verification sender below for its double opt-in.
    enabled: false,
  },
  emailVerification: {
    // No local sign-ups (OIDC JIT provisions users with verified emails).
    // Keep the sender: the change-email double opt-in routes the NEW-address
    // verification through it.
    sendOnSignUp: false,
    sendVerificationEmail: async ({ user, url }) => {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Auth] Sending verification email to:', user.email);
      }
      await triggerEmail({
        to: user.email,
        subject: 'Verify your email for OpenComp',
        react: VerifyEmail({ email: user.email, url }),
      });
    },
  },
  advanced: {
    database: {
      generateId: false,
    },
    // Prevent cookie collisions between environments.
    // Production keeps the default 'better-auth' prefix (unchanged).
    ...(cookieDomain === '.staging.gideondefender.com' && {
      cookiePrefix: 'staging',
    }),
    ...(cookieDomain === '.dev.gideondefender.com' && {
      cookiePrefix: 'dev',
    }),
    ...(!cookieDomain && {
      cookiePrefix: 'local',
    }),
    ...(cookieDomain && {
      crossSubDomainCookies: {
        enabled: true,
        domain: cookieDomain,
      },
      defaultCookieAttributes: {
        sameSite: 'lax' as const,
        secure: true,
      },
    }),
  },
  databaseHooks: authDatabaseHooks,
  // SECRET_KEY is validated at startup via validateSecurityConfig()
  secret: process.env.SECRET_KEY as string,
  plugins: [
    idpOrganizationAccessPlugin(),
    organization({
      membershipLimit: 100000000000,
      sendInvitationEmail(data): Promise<void> {
        // IdP-owned user management (Phase 3-server): invitations are dead.
        // The /api/auth/organization/* invite paths are fenced with 410
        // before better-auth runs; this rejects fail-closed so any residual
        // path fails loudly instead of sending a local invite email.
        // Phase 4 deletes the template + this callback.
        return Promise.reject(
          new GoneException(
            `Invitation ${data.invitation.id} for ${data.email}: membership is managed in the Gideon identity service.`,
          ),
        );
      },
      ac: ac,
      roles: allRoles,
      // Enable dynamic access control for custom roles
      // This allows organizations to create custom roles at runtime
      // Roles are stored in better-auth's internal tables
      dynamicAccessControl: {
        enabled: true,
        // Limit custom roles per organization to prevent abuse
        maximumRolesPerOrganization: 100,
      },
      schema: {
        organization: {
          modelName: 'Organization',
        },
        // Custom roles table for dynamic access control
        organizationRole: {
          modelName: 'OrganizationRole',
          fields: {
            role: 'name',
            permission: 'permissions',
          },
        },
      },
    }),
    multiSession(),
    bearer(),
    // OAuth 2.0 / OIDC provider for hosted MCP (Gram). Wraps oidcProvider and
    // exposes /api/auth/mcp/* (authorize, token, register) + the two
    // /api/auth/.well-known/* discovery docs, plus the auth.api.getMcpSession()
    // helper used by HybridAuthGuard. (Gram points its OAuth proxy at /mcp/*.)
    mcp({
      loginPage: mcpLoginPage,
      ...(process.env.MCP_RESOURCE_URL
        ? { resource: process.env.MCP_RESOURCE_URL }
        : {}),
      oidcConfig: {
        loginPage: mcpLoginPage,
        allowDynamicClientRegistration: false,
        ...(gramMcpClient ? { trustedClients: [gramMcpClient] } : {}),
      },
    }),
  ],
  user: {
    modelName: 'User',
    changeEmail: {
      enabled: true,
      // Double opt-in: this link goes to the CURRENT address; confirming it
      // makes better-auth send a verification link to the NEW address (via
      // emailVerification.sendVerificationEmail), which applies the change.
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        await triggerEmail({
          to: user.email,
          subject: 'Confirm your email change for OpenComp',
          react: ChangeEmailConfirmationEmail({
            currentEmail: user.email,
            newEmail,
            url,
          }),
        });
      },
    },
  },
  organization: {
    modelName: 'Organization',
  },
  member: {
    modelName: 'Member',
  },
  invitation: {
    modelName: 'Invitation',
  },
  session: {
    modelName: 'Session',
  },
  account: {
    modelName: 'Account',
    accountLinking: {
      // No social providers remain (Gideon OIDC provisions users directly).
      enabled: false,
      trustedProviders: [],
    },
    // Skip the state cookie CSRF check for OAuth flows.
    // In our cross-origin setup (app/portal → API), the state cookie may not
    // survive the OAuth redirect flow. The OAuth state parameter stored in the
    // database already provides CSRF protection (random 32-char string validated
    // against the DB). This is the same approach better-auth's oAuthProxy plugin uses.
    skipStateCookieCheck: true,
  },
  verification: {
    modelName: 'Verification',
  },
});
