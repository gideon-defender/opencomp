import { validateAzureWriteStepParams } from './azure-remediation-param-guardrails';

const SUB = '12345678-1234-1234-1234-1234567890ab';

function check(step: {
  method: string;
  url: string;
  body?: unknown;
}): string[] {
  return validateAzureWriteStepParams(step, { index: 2 });
}

describe('validateAzureSubresourceDepth via validateAzureWriteStepParams', () => {
  it('refuses code-execution and open-access sub-resource depths', () => {
    // VM extensions run code on the machine: no remediation fix needs
    // them, even though the Compute prefix admits the URL shape.
    const extUrl =
      `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
      `/providers/Microsoft.Compute/virtualMachines/vm/extensions/custom?api-version=2023-07-01`;
    expect(
      check({
        method: 'PUT',
        url: extUrl,
        body: { properties: { publisher: 'p' } },
      }).join(' '),
    ).toContain('.../extensions/ writes run code');
    // SQL firewall rules opened to the internet undo network isolation.
    const fwUrl =
      `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
      `/providers/Microsoft.Sql/servers/srv/firewallRules/allowAll?api-version=2023-05-01-preview`;
    expect(
      check({
        method: 'PUT',
        url: fwUrl,
        body: {
          properties: {
            startIpAddress: '0.0.0.0',
            endIpAddress: '255.255.255.255',
          },
        },
      }).join(' '),
    ).toContain('firewall rule open to');
    // A scoped office range on the same URL shape passes the depth guard.
    // (The resource-group pin still applies separately when scoped.)
    expect(
      check({
        method: 'PUT',
        url: fwUrl,
        body: {
          properties: { startIpAddress: '10.0.0.1', endIpAddress: '10.0.0.1' },
        },
      }),
    ).toEqual([]);
  });

  it('refuses near-open, unparseable, and inverted firewall ranges', () => {
    const fwUrl =
      `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
      `/providers/Microsoft.Sql/servers/srv/firewallRules/allowAll?api-version=2023-05-01-preview`;
    const refused: Array<[string, unknown, unknown]> = [
      // Anchored at an internet edge: admits all but a sliver of the space.
      ['low edge', '0.0.0.0', '255.255.255.254'],
      ['high edge', '0.0.0.1', '255.255.255.255'],
      // Full coverage without touching an edge: same exposure, no anchor.
      ['near-full coverage', '0.0.0.1', '255.255.255.254'],
      // Wider than a /16 with no edge anchor: still internet-open.
      ['wide range', '100.0.0.0', '101.255.255.255'],
      // Garbage the guard cannot read fails closed.
      ['octet overflow', '999.1.1.1', '10.0.0.1'],
      ['not an IP', 'anywhere', 'anywhere'],
      ['octal-looking', '01.02.03.04', '01.02.03.04'],
      // Inverted ranges are malformed and fail closed.
      ['inverted', '10.0.0.2', '10.0.0.1'],
    ];
    for (const [name, startIpAddress, endIpAddress] of refused) {
      expect(
        `${name}: ${check({
          method: 'PUT',
          url: fwUrl,
          body: { properties: { startIpAddress, endIpAddress } },
        }).join(' ')}`,
      ).toContain('firewall rule open to');
    }
  });

  it('refuses the bare extensions collection but not a VM named extensions', () => {
    const base =
      `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
      `/providers/Microsoft.Compute/virtualMachines`;
    // The normalizer strips the trailing slash, so the bare collection
    // path carries no `/extensions/` substring — segment comparison
    // must still catch it.
    expect(
      check({
        method: 'PUT',
        url: `${base}/vm/extensions?api-version=2023-07-01`,
        body: { properties: { publisher: 'p' } },
      }).join(' '),
    ).toContain('.../extensions/ writes run code');
    // A VM literally named "extensions" is the resource itself, not an
    // extension child — fixing it must not be refused.
    expect(
      check({
        method: 'PATCH',
        url: `${base}/extensions?api-version=2023-07-01`,
        body: { tags: { env: 'prod' } },
      }),
    ).toEqual([]);
  });
});
