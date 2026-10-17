// API keys, service tokens, native sessions, and OIDC JWT authentication.
// The public authType value `gideon` is retained for OIDC wire compatibility.

export interface AuthenticatedRequest extends Request {
  organizationId: string;
  authType: 'api-key' | 'session' | 'service' | 'gideon';
  isApiKey: boolean;
  isServiceToken?: boolean;
  serviceName?: string;
  isOidcJwt?: boolean;
  userId?: string;
  userEmail?: string;
  userRoles: string[] | null;
  memberId?: string; // Member ID for assignment filtering (only available for session auth)
  memberDepartment?: string; // Member department for visibility filtering (only available for session auth)
  apiKeyScopes?: string[]; // Scopes for API key auth (empty = legacy full access)
  apiKeyId?: string; // ApiKey row id — only set for API key auth. Used by ActingUserResolver / audit log attribution.
  apiKeyName?: string; // Human-readable API key name (e.g. "CI Pipeline") — only set for API key auth.
  apiKeyCreatedByMemberId?: string | null; // Member (org membership) that created the key — only set for API key auth. Lets ActingUserResolver attribute mutations to the real creator instead of the org owner.
  sessionId?: string; // Session ID (only set for session auth)
  sessionDeviceAgent?: boolean; // Whether the session is a device-agent session (only set for session auth)
  isMcpOAuth?: boolean; // True when authenticated via a hosted-MCP OAuth token (no real session). PermissionGuard checks RBAC from userRoles instead of better-auth's session-based hasPermission.
  oidcAal?: number; // Assurance level from an OIDC JWT payload (only set for OIDC-JWT auth). Surfaced for a future aal >= 2 gate — no consumer enforces it yet.
}

export interface AuthContext {
  organizationId: string;
  authType: 'api-key' | 'session' | 'service' | 'gideon';
  isApiKey: boolean;
  isServiceToken?: boolean;
  isOidcJwt?: boolean;
  isMcpOAuth?: boolean;
  serviceName?: string;
  userId?: string; // Only available for session auth
  userEmail?: string; // Only available for session auth
  userRoles: string[] | null;
  memberId?: string; // Member ID for assignment filtering (only available for session auth)
  memberDepartment?: string; // Member department for visibility filtering (only available for session auth)
  apiKeyScopes?: string[]; // Scopes for API key auth (empty = legacy full access)
  apiKeyId?: string; // ApiKey row id — only set for API key auth.
  apiKeyName?: string; // Human-readable API key name — only set for API key auth.
  apiKeyCreatedByMemberId?: string | null; // Member that created the key — only set for API key auth.
  oidcAal?: number; // Assurance level from an OIDC JWT (only set for OIDC-JWT auth). Surfaced for a future aal >= 2 gate — no consumer enforces it yet.
}
