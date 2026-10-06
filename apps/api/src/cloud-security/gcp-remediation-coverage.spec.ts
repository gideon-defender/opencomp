import {
  gcpFindingToAssetClass,
  isApprovalGatedGcpAssetClass,
} from '@gideon-defender/integration-platform';
import {
  GCP_GUIDED_ONLY_API_HOSTS,
  gcpAllowlistedApiHosts,
} from './gcp-remediation-prompt-allowlist';

/**
 * Prompt ↔ enforcement drift detector.
 *
 * Every API host the system prompt documents with fix semantics must
 * resolve to exactly one posture: allowlisted (executable), guided-only
 * (model must not emit fix steps), or gated (findings route to an
 * approval-gated class). When the prompt gains a documented API, this
 * spec forces the author to make that decision explicitly.
 *
 * Current resolutions:
 * - container.googleapis.com (GKE): guided-only — cluster updates can
 *   require recreation or cause control-plane downtime.
 * - logging.googleapis.com (sinks/metrics): guided-only — sink writes
 *   change auditability posture.
 * - cloudresourcemanager.googleapis.com (:setIamPolicy): gated — IAM
 *   findings route to Security-Global (human approval), and the strict
 *   shape validator guards the body.
 */
const PROMPT_DOCUMENTED_HOSTS: Record<
  string,
  'allowlisted' | 'guided-only' | 'gated'
> = {
  'storage.googleapis.com': 'allowlisted',
  'compute.googleapis.com': 'allowlisted',
  'sqladmin.googleapis.com': 'allowlisted',
  'cloudkms.googleapis.com': 'allowlisted',
  'monitoring.googleapis.com': 'allowlisted',
  'dns.googleapis.com': 'allowlisted',
  'bigquery.googleapis.com': 'allowlisted',
  'pubsub.googleapis.com': 'allowlisted',
  'container.googleapis.com': 'guided-only',
  'logging.googleapis.com': 'guided-only',
  'cloudresourcemanager.googleapis.com': 'gated',
};

describe('GCP prompt/enforcement coverage', () => {
  it('resolves every prompt-documented host to an explicit posture', () => {
    const allowlisted = gcpAllowlistedApiHosts();
    for (const [host, posture] of Object.entries(PROMPT_DOCUMENTED_HOSTS)) {
      if (posture === 'allowlisted') {
        expect(allowlisted.has(host)).toBe(true);
      } else if (posture === 'guided-only') {
        expect(GCP_GUIDED_ONLY_API_HOSTS.has(host)).toBe(true);
        expect(allowlisted.has(host)).toBe(false);
      } else {
        // Gated: must NOT be directly executable — refusal comes from
        // the class gate plus the allowlist (no entry), never from luck.
        expect(allowlisted.has(host)).toBe(false);
        expect(GCP_GUIDED_ONLY_API_HOSTS.has(host)).toBe(false);
      }
    }
  });

  it('routes setIamPolicy findings to the approval-gated class', () => {
    // IAM audit findings carry the project resource type, which must stay
    // in the human-approval class — the gate (not the allowlist) is what
    // keeps :setIamPolicy out of one-click fix.
    expect(gcpFindingToAssetClass('gcp-project')).toBe('Security-Global');
    expect(isApprovalGatedGcpAssetClass('Security-Global')).toBe(true);
  });

  it('documents every allowlisted host in the matrix (no silent executables)', () => {
    const allowlisted = gcpAllowlistedApiHosts();
    for (const host of allowlisted) {
      expect(PROMPT_DOCUMENTED_HOSTS[host]).toBe('allowlisted');
    }
  });
});
