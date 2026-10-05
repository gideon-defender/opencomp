import {
  buildAllowlistPromptSection,
  GCP_GUIDED_ONLY_API_HOSTS,
  gcpAllowlistedApiHosts,
  withGcpAllowlistSection,
} from './gcp-remediation-prompt-allowlist';

describe('withGcpAllowlistSection', () => {
  it('is a no-op without an asset class (unscoped callers unchanged)', () => {
    expect(withGcpAllowlistSection('base', undefined)).toBe('base');
  });

  it('appends the class section when scoped', () => {
    const out = withGcpAllowlistSection('base', 'Storage');
    expect(out.startsWith('base')).toBe(true);
    expect(out).toContain('asset class: Storage');
    expect(out).toContain(
      'PATCH https://storage.googleapis.com/storage/v1/b/…',
    );
    expect(out).not.toContain('compute.googleapis.com/compute');
  });
});

describe('buildAllowlistPromptSection', () => {
  it('lists only the class entries plus guided-only hosts', () => {
    const out = buildAllowlistPromptSection('Data');
    expect(out).toContain('sqladmin.googleapis.com');
    expect(out).toContain('bigquery.googleapis.com');
    expect(out).toContain('container.googleapis.com');
    expect(out).not.toContain('storage.googleapis.com/storage');
  });

  it('tells gated classes to stay guided-only', () => {
    expect(buildAllowlistPromptSection('Network')).toMatch(/approval-gated/);
    expect(buildAllowlistPromptSection('Security-Global')).toMatch(
      /approval-gated/,
    );
    expect(buildAllowlistPromptSection('Storage')).not.toMatch(
      /approval-gated/,
    );
  });

  it('derives executable hosts from the real allowlist (no duplication)', () => {
    const hosts = gcpAllowlistedApiHosts();
    expect(hosts.has('storage.googleapis.com')).toBe(true);
    expect(hosts.has('sqladmin.googleapis.com')).toBe(true);
    // Guided-only hosts are never executable.
    for (const host of GCP_GUIDED_ONLY_API_HOSTS.keys()) {
      expect(hosts.has(host)).toBe(false);
    }
  });
});
