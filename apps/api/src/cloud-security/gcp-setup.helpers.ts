import type {
  GCPSecurityService,
  GcpSetupStep,
} from './providers/gcp-security.service';
import type { CloudSecurityService } from './cloud-security.service';

export function withGcpResolveActions(
  steps: GcpSetupStep[],
  connectionId: string,
): GcpSetupStep[] {
  return steps.map((step) => {
    if (step.success) return step;
    return {
      ...step,
      resolveAction: {
        label: 'Resolve this',
        method: 'POST',
        endpoint: `/v1/cloud-security/setup-gcp/${connectionId}/resolve-step`,
        body: { stepId: step.id },
      },
    };
  });
}

/**
 * Read selected project IDs from connection variables.
 * Only reads the new `project_ids` array — the old `project_id` string
 * was auto-saved by previous code and does NOT represent user choice.
 */
export function readProjectIds(variables: Record<string, unknown>): string[] {
  if (!Array.isArray(variables.project_ids)) {
    return [];
  }
  // Persisted junk (non-string values can land via legacy writes) must not
  // flow into GCP calls — filter rather than trust the array's element type.
  return variables.project_ids.filter(
    (id): id is string => typeof id === 'string',
  );
}

export async function resolveGcpSetupContext(
  cloudSecurityService: CloudSecurityService,
  gcpSecurityService: GCPSecurityService,
  connectionId: string,
  organizationId: string,
  overrideProjectId?: string,
) {
  const connection = await cloudSecurityService.getConnectionForDetect(
    connectionId,
    organizationId,
  );

  const credentials = connection.credentials as Record<string, unknown>;
  const accessToken = credentials?.access_token as string;
  if (!accessToken) {
    throw new Error('No access token found. Reconnect the GCP integration.');
  }

  const variables = (connection.variables ?? {}) as Record<string, unknown>;
  let gcpOrgId = variables.organization_id as string | undefined;

  if (!gcpOrgId) {
    const orgs = await gcpSecurityService.detectOrganizations(accessToken);
    if (orgs.length === 1) {
      // Mirrors detect-gcp-org: auto-save only when the choice is unambiguous.
      gcpOrgId = orgs[0].id;
      await cloudSecurityService.saveConnectionVariable(
        connectionId,
        'organization_id',
        gcpOrgId,
        organizationId,
      );
    } else if (orgs.length > 1) {
      // Never pin an arbitrary org for the caller (detect-gcp-org asks the
      // user to choose in this case). Setup would enable APIs and scope
      // projects against the wrong organization.
      throw new Error(
        'Multiple GCP organizations are accessible with this connection. ' +
          'Call POST /v1/cloud-security/detect-gcp-org/{connectionId}, pick an organization, ' +
          'and save it via POST /v1/cloud-security/select-gcp-projects/{connectionId} before setup.',
      );
    }
  }

  // Fetch projects scoped to the org when available, else all
  const projects = gcpOrgId
    ? await gcpSecurityService.detectProjectsForOrg(accessToken, gcpOrgId)
    : await gcpSecurityService.detectProjects(accessToken);

  // For API enablement, use override or first selected project
  const selectedIds = readProjectIds(variables);
  const projectId = overrideProjectId || selectedIds[0] || projects[0]?.id;

  if (!projectId) {
    throw new Error(
      'No GCP projects found. Ensure your account has access to at least one project.',
    );
  }

  return {
    accessToken,
    organizationId: gcpOrgId,
    projectId,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
    })),
    selectedProjectIds: selectedIds,
  };
}
