import { validateAzureWriteStepParams } from './azure-remediation-param-guardrails';

const SUB = '12345678-1234-1234-1234-1234567890ab';
const NSG_RULE_URL =
  `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg` +
  `/providers/Microsoft.Network/networkSecurityGroups/nsg/securityRules/allow-ssh?api-version=2023-11-01`;

function check(step: {
  method: string;
  url: string;
  body?: unknown;
}): string[] {
  return validateAzureWriteStepParams(step, { index: 2 });
}

function nsgBody(rule: Record<string, unknown>) {
  return {
    method: 'PUT',
    url: NSG_RULE_URL,
    body: { properties: rule },
  };
}

describe('validateNsgRules via validateAzureWriteStepParams', () => {
  it('refuses NSG Allow rules open to the world on every port', () => {
    const findings = check(
      nsgBody({
        access: 'Allow',
        sourceAddressPrefix: '0.0.0.0/0',
        destinationPortRange: '*',
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('Step 2 (PUT');
    expect(findings[0]).toContain('"0.0.0.0/0"');
  });

  it('refuses NSG Allow rules open to the IPv6 internet on every port', () => {
    const findings = check(
      nsgBody({
        access: 'Allow',
        sourceAddressPrefix: '::/0',
        destinationPortRange: '*',
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('"::/0"');
  });

  it('refuses NSG Allow rules nested under rule properties', () => {
    // ARM group PUTs nest per-rule fields: {name, properties: {...}}.
    const nested = check({
      method: 'PUT',
      url: NSG_RULE_URL,
      body: {
        properties: {
          securityRules: [
            {
              name: 'evil',
              properties: {
                access: 'Allow',
                sourceAddressPrefix: 'Internet',
                destinationPortRange: '0-65535',
              },
            },
          ],
        },
      },
    });
    expect(nested).toHaveLength(1);
    expect(nested[0]).toContain('"Internet"');
    // Array shapes on source and ports also trip the guard.
    const listed = check({
      method: 'PUT',
      url: NSG_RULE_URL,
      body: {
        properties: {
          access: 'Allow',
          sourceAddressPrefixes: ['10.0.0.0/8', ' 0.0.0.0/0 '],
          destinationPortRanges: ['443', '*'],
        },
      },
    });
    expect(listed).toHaveLength(1);
  });

  it('allows scoped NSG rules and Deny rules', () => {
    expect(
      check(
        nsgBody({
          access: 'Allow',
          sourceAddressPrefix: '10.0.0.0/8',
          destinationPortRange: '22',
        }),
      ),
    ).toEqual([]);
    expect(
      check(
        nsgBody({
          access: 'Deny',
          sourceAddressPrefix: '*',
          destinationPortRange: '*',
        }),
      ),
    ).toEqual([]);
  });

  it('refuses internet-open inbound rules on a single sensitive port', () => {
    // The classic SSH-to-internet misconfig: one port, not every port.
    for (const port of ['22', '3389']) {
      const findings = check(
        nsgBody({
          access: 'Allow',
          sourceAddressPrefix: '*',
          destinationPortRange: port,
        }),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain(`sensitive port ${port}`);
    }
    // A range spanning sensitive ports refuses on the first one hit.
    expect(
      check(
        nsgBody({
          access: 'Allow',
          sourceAddressPrefix: '0.0.0.0/0',
          destinationPortRange: '20-25',
        }),
      ).join(' '),
    ).toContain('sensitive port 21');
    // A missing direction reads as inbound, never as safe.
    expect(
      check(
        nsgBody({
          access: 'Allow',
          sourceAddressPrefix: 'Internet',
          destinationPortRange: '1433',
        }),
      ).join(' '),
    ).toContain('sensitive port 1433');
  });

  it('allows public web ports and outbound rules past the port check', () => {
    // A public web server legitimately serves 443 to the internet.
    expect(
      check(
        nsgBody({
          direction: 'Inbound',
          access: 'Allow',
          sourceAddressPrefix: '*',
          destinationPortRange: '443',
        }),
      ),
    ).toEqual([]);
    // Outbound open-source names local senders, not internet callers.
    expect(
      check(
        nsgBody({
          direction: 'Outbound',
          access: 'Allow',
          sourceAddressPrefix: '*',
          destinationPortRange: '22',
        }),
      ),
    ).toEqual([]);
  });
});
