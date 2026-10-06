import { AZURE_SYSTEM_PROMPT } from './azure-ai-remediation.prompt';
import {
  azureAllowlistedApiHosts,
  buildAzureAllowlistPromptSection,
  withAzureAllowlistSection,
} from './azure-remediation-prompt-allowlist';
import { isAzureAllowlistedFixStep } from '@gideon-defender/integration-platform';

describe('withAzureAllowlistSection', () => {
  it('is a no-op without an asset class', () => {
    expect(withAzureAllowlistSection('base', undefined)).toBe('base');
  });

  it('renders the class entries plus never-allow grants', () => {
    const section = withAzureAllowlistSection('base', 'Storage');
    expect(section).toContain('## EXECUTION ALLOWLIST (asset class: Storage)');
    expect(section).toContain(
      '- PATCH https://management.azure.com/providers/microsoft.storage/storageaccounts',
    );
    expect(section).toContain('Microsoft.Authorization/roleAssignments/write');
    expect(section).not.toContain('is approval-gated');
  });

  it('isolates classes: Storage lists only its own calls', () => {
    const section = buildAzureAllowlistPromptSection('Storage');
    expect(section).toContain('microsoft.storage/storageaccounts');
    expect(section).not.toContain('virtualmachines');
    expect(section).not.toContain('networksecuritygroups');
    expect(section).not.toContain('databaseaccounts');
  });

  it('banners approval-gated classes as guided-only', () => {
    for (const gated of ['Network', 'Security-Global'] as const) {
      const section = buildAzureAllowlistPromptSection(gated);
      expect(section).toContain('canAutoFix=false');
    }
  });

  it('covers only the management host', () => {
    expect(azureAllowlistedApiHosts()).toEqual(
      new Set(['management.azure.com']),
    );
  });
});

describe('prompt/allowlist drift', () => {
  // Namespaces the system prompt documents that are intentionally
  // human-only (identity plane reads, Key Vault writes): every other
  // documented namespace must probe allowlisted in its class.
  const GUIDED_ONLY_NAMESPACES = new Set([
    'microsoft.keyvault',
    'microsoft.authorization',
  ]);

  const NAMESPACE_PROBES: Record<
    string,
    {
      assetClass:
        'Storage' | 'Compute' | 'Network' | 'Data' | 'Security-Global';
      path: string;
      method: 'PATCH' | 'PUT';
    }
  > = {
    'microsoft.storage': {
      assetClass: 'Storage',
      path: 'providers/Microsoft.Storage/storageAccounts/probe',
      method: 'PATCH',
    },
    'microsoft.compute': {
      assetClass: 'Compute',
      path: 'providers/Microsoft.Compute/virtualMachines/probe',
      method: 'PATCH',
    },
    'microsoft.containerservice': {
      assetClass: 'Compute',
      path: 'providers/Microsoft.ContainerService/managedClusters/probe',
      method: 'PATCH',
    },
    'microsoft.containerregistry': {
      assetClass: 'Compute',
      path: 'providers/Microsoft.ContainerRegistry/registries/probe',
      method: 'PATCH',
    },
    'microsoft.network': {
      assetClass: 'Network',
      path: 'providers/Microsoft.Network/networkSecurityGroups/probe',
      method: 'PUT',
    },
    'microsoft.sql': {
      assetClass: 'Data',
      path: 'providers/Microsoft.Sql/servers/probe',
      method: 'PATCH',
    },
    'microsoft.documentdb': {
      assetClass: 'Data',
      path: 'providers/Microsoft.DocumentDB/databaseAccounts/probe',
      method: 'PATCH',
    },
    'microsoft.security': {
      assetClass: 'Security-Global',
      path: 'providers/Microsoft.Security/pricings/default',
      method: 'PUT',
    },
    'microsoft.insights': {
      assetClass: 'Security-Global',
      path: 'providers/Microsoft.Insights/diagnosticSettings/probe',
      method: 'PUT',
    },
    'microsoft.operationalinsights': {
      assetClass: 'Security-Global',
      path: 'providers/Microsoft.OperationalInsights/workspaces/probe',
      method: 'PUT',
    },
  };

  it('every API namespace the prompt documents is allowlisted or explicitly guided-only', () => {
    const documented = new Set(
      [...AZURE_SYSTEM_PROMPT.matchAll(/Microsoft\.([A-Za-z]+)\//g)].map(
        (match) => `microsoft.${(match[1] ?? '').toLowerCase()}`,
      ),
    );
    expect(documented.size).toBeGreaterThan(0);
    for (const namespace of documented) {
      if (GUIDED_ONLY_NAMESPACES.has(namespace)) continue;
      const probe = NAMESPACE_PROBES[namespace];
      if (!probe) {
        throw new Error(`${namespace} is documented but has no probe`);
      }
      const url =
        `https://management.azure.com/subscriptions/00000000-0000-0000-0000-000000000000/` +
        `resourceGroups/rg/${probe.path}?api-version=2023-01-01`;
      if (
        !isAzureAllowlistedFixStep({
          assetClass: probe.assetClass,
          method: probe.method,
          url,
        })
      ) {
        throw new Error(
          `${namespace} is documented in the prompt but not allowlisted — add it or mark it guided-only`,
        );
      }
    }
  });
});
