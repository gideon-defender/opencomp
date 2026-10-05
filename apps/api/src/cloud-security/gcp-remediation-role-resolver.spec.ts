import { resolveGcpRemediationIdentity } from './gcp-remediation-role-resolver';

const SA = 'opencomp-remediator@my-proj-123.iam.gserviceaccount.com';

function credsWith(map: Record<string, string>) {
  return { gcpRemediation: JSON.stringify(map) };
}

describe('resolveGcpRemediationIdentity', () => {
  it('resolves the bound SA for the finding class/project', () => {
    const result = resolveGcpRemediationIdentity({
      credentials: credsWith({ 'Storage:my-proj-123': SA }),
      resourceType: 'gcp-storage-bucket',
      projectId: 'my-proj-123',
    });
    expect(result).toEqual({
      saEmail: SA,
      assetClass: 'Storage',
      approvalGated: false,
      expectedKey: 'Storage:my-proj-123',
    });
  });

  it('leaves the SA unresolved when no binding exists (fail closed)', () => {
    const result = resolveGcpRemediationIdentity({
      credentials: {},
      resourceType: 'gcp-storage-bucket',
      projectId: 'my-proj-123',
    });
    expect(result.saEmail).toBeUndefined();
    expect(result.assetClass).toBe('Storage');
    expect(result.expectedKey).toBe('Storage:my-proj-123');
  });

  it('marks gated classes even when bound', () => {
    const result = resolveGcpRemediationIdentity({
      credentials: credsWith({ 'Network:my-proj-123': SA }),
      resourceType: 'gcp-firewall-rule',
      projectId: 'my-proj-123',
    });
    expect(result.saEmail).toBe(SA);
    expect(result.assetClass).toBe('Network');
    expect(result.approvalGated).toBe(true);
  });

  it('routes unknown types to Security-Global without throwing', () => {
    const result = resolveGcpRemediationIdentity({
      credentials: {},
      resourceType: 'gcp-brand-new-service',
      projectId: 'my-proj-123',
    });
    expect(result.saEmail).toBeUndefined();
    expect(result.assetClass).toBe('Security-Global');
    expect(result.approvalGated).toBe(true);
  });

  it('degrades to guided-only on garbage project ids instead of throwing', () => {
    const result = resolveGcpRemediationIdentity({
      credentials: credsWith({ 'Storage:my-proj-123': SA }),
      resourceType: 'gcp-storage-bucket',
      projectId: 'BAD!!',
    });
    expect(result.saEmail).toBeUndefined();
  });
});
