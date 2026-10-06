import {
  isFirewallInsert,
  isFirewallPath,
  validateGcpFirewallPatch,
} from './gcp-remediation-firewall-guardrails';
import { validateGcpWriteStepParams } from './gcp-remediation-param-guardrails';

function fixStep(overrides: Record<string, unknown> = {}) {
  return {
    method: 'PATCH',
    url: 'https://example.googleapis.com/v1/x',
    body: {},
    purpose: 'fix',
    ...overrides,
  } as Parameters<typeof validateGcpWriteStepParams>[0];
}

const PREFIX = 'Step 1 (PATCH /firewalls/f)';

describe('isFirewallPath', () => {
  it('matches rule and collection paths only', () => {
    expect(isFirewallPath('/compute/v1/projects/p/global/firewalls/f')).toBe(
      true,
    );
    expect(isFirewallPath('/compute/v1/projects/p/global/firewalls')).toBe(
      true,
    );
    expect(isFirewallPath('/compute/v1/projects/p/global/firewallsEvil')).toBe(
      false,
    );
  });
});

describe('isFirewallInsert', () => {
  it('detects creates on the collection path', () => {
    expect(
      isFirewallInsert('/compute/v1/projects/p/global/firewalls', 'POST'),
    ).toBe(true);
    expect(
      isFirewallInsert('/compute/v1/projects/p/global/firewalls/', 'POST'),
    ).toBe(true);
    expect(
      isFirewallInsert('/compute/v1/projects/p/global/firewalls/f', 'POST'),
    ).toBe(false);
    expect(
      isFirewallInsert('/compute/v1/projects/p/global/firewalls', 'PATCH'),
    ).toBe(false);
  });
});

describe('validateGcpFirewallPatch inserts', () => {
  it('refuses an ingress insert without sourceRanges', () => {
    const errors = validateGcpFirewallPatch(
      { allowed: [{ IPProtocol: 'tcp', ports: ['443'] }] },
      PREFIX,
      true,
    );
    expect(errors.join(' ')).toMatch(/without sourceRanges/);
  });

  it('refuses an egress insert without destinationRanges', () => {
    const errors = validateGcpFirewallPatch(
      {
        direction: 'EGRESS',
        sourceRanges: ['10.0.0.0/8'],
        allowed: [{ IPProtocol: 'tcp', ports: ['443'] }],
      },
      PREFIX,
      true,
    );
    expect(errors.join(' ')).toMatch(/without destinationRanges/);
  });

  it('allows PATCH without ranges (absent list changes nothing)', () => {
    expect(
      validateGcpFirewallPatch(
        { allowed: [{ IPProtocol: 'tcp', ports: ['443'] }] },
        PREFIX,
        false,
      ),
    ).toEqual([]);
  });

  it('refuses case-variant "ALL" and port-less tcp', () => {
    expect(
      validateGcpFirewallPatch(
        { sourceRanges: ['10.0.0.0/8'], allowed: [{ IPProtocol: 'All' }] },
        PREFIX,
        false,
      ).join(' '),
    ).toMatch(/over-broad/);
    expect(
      validateGcpFirewallPatch(
        { sourceRanges: ['10.0.0.0/8'], allowed: [{ IPProtocol: 'udp' }] },
        PREFIX,
        false,
      ).join(' '),
    ).toMatch(/without ports/);
  });

  it('refuses PATCH retargeting that keeps ranges narrow', () => {
    // Narrow ranges with a widened scope still enforce on every instance —
    // the retarget is invisible without the stored rule.
    for (const body of [
      { sourceRanges: ['10.0.0.0/8'], targetTags: [] },
      {
        sourceRanges: ['10.0.0.0/8'],
        targetServiceAccounts: ['x@y.iam.gserviceaccount.com'],
      },
      { sourceRanges: ['10.0.0.0/8'], sourceTags: ['web'] },
    ]) {
      expect(validateGcpFirewallPatch(body, PREFIX, false).join(' ')).toMatch(
        /firewall scope/,
      );
    }
  });

  it('refuses source tags on inserts even with narrow ranges', () => {
    // Source tags union with sourceRanges: tagged instances anywhere
    // bypass the narrow list.
    expect(
      validateGcpFirewallPatch(
        { sourceRanges: ['10.0.0.0/8'], sourceTags: ['web'] },
        PREFIX,
        true,
      ).join(' '),
    ).toMatch(/firewall scope/);
  });
});

describe('validateGcpWriteStepParams firewall inserts', () => {
  const COLLECTION =
    'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls';
  const RULE = `${COLLECTION}/f`;

  it('refuses an ingress insert without sourceRanges (defaults open)', () => {
    const errors = validateGcpWriteStepParams(
      fixStep({
        method: 'POST',
        url: COLLECTION,
        body: { allowed: [{ IPProtocol: 'tcp', ports: ['443'] }] },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/without sourceRanges/);
  });

  it('refuses an egress insert without destinationRanges', () => {
    const errors = validateGcpWriteStepParams(
      fixStep({
        method: 'POST',
        url: COLLECTION,
        body: {
          direction: 'EGRESS',
          sourceRanges: ['10.0.0.0/8'],
          allowed: [{ IPProtocol: 'tcp', ports: ['443'] }],
        },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/without destinationRanges/);
  });

  it('allows PATCH without ranges (absent list changes nothing)', () => {
    const errors = validateGcpWriteStepParams(
      fixStep({
        url: RULE,
        body: { allowed: [{ IPProtocol: 'tcp', ports: ['443'] }] },
      }),
      { index: 0 },
    );
    expect(errors).toEqual([]);
  });

  it('refuses malformed allowed entries instead of skipping them', () => {
    // A non-object entry cannot prove a narrow port range — skipping it
    // would let the rule pass the port gate without showing one.
    const entryErrors = validateGcpWriteStepParams(
      fixStep({
        url: RULE,
        body: {
          sourceRanges: ['10.0.0.0/8'],
          allowed: ['tcp'],
        },
      }),
      { index: 0 },
    );
    expect(entryErrors.join(' ')).toMatch(/malformed protocol rule/);
    const listErrors = validateGcpWriteStepParams(
      fixStep({
        url: RULE,
        body: {
          sourceRanges: ['10.0.0.0/8'],
          allowed: 'tcp',
        },
      }),
      { index: 0 },
    );
    expect(listErrors.join(' ')).toMatch(/must be a list/);
  });

  it('refuses case-variant IPProtocol "ALL" through dispatch', () => {
    const errors = validateGcpWriteStepParams(
      fixStep({
        url: RULE,
        body: {
          sourceRanges: ['10.0.0.0/8'],
          allowed: [{ IPProtocol: 'ALL' }],
        },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/over-broad/);
  });

  it('refuses tcp without ports but allows it with ports', () => {
    const open = validateGcpWriteStepParams(
      fixStep({
        url: RULE,
        body: {
          sourceRanges: ['10.0.0.0/8'],
          allowed: [{ IPProtocol: 'tcp' }],
        },
      }),
      { index: 0 },
    );
    expect(open.join(' ')).toMatch(/without ports/);

    const narrow = validateGcpWriteStepParams(
      fixStep({
        url: RULE,
        body: {
          sourceRanges: ['10.0.0.0/8'],
          allowed: [{ IPProtocol: 'tcp', ports: ['443'] }],
        },
      }),
      { index: 0 },
    );
    expect(narrow).toEqual([]);
  });

  it('refuses disabling a rule (disabling a DENY widens access)', () => {
    const errors = validateGcpFirewallPatch({ disabled: true }, PREFIX, false);
    expect(errors.join(' ')).toMatch(/disabled/);
  });

  it('refuses enabling a rule (activates unseen stored config)', () => {
    const errors = validateGcpFirewallPatch(
      { disabled: false, sourceRanges: ['10.0.0.0/8'] },
      PREFIX,
      false,
    );
    expect(errors.join(' ')).toMatch(/disabled/);
  });

  it('refuses replacing the deny list on a patch', () => {
    const errors = validateGcpFirewallPatch(
      { denied: [{ IPProtocol: 'tcp', ports: ['22'] }] },
      PREFIX,
      false,
    );
    expect(errors.join(' ')).toMatch(/deny list/);
  });

  it('refuses a direction flip on a patch (range checks see absent lists)', () => {
    // A lone `{direction: "EGRESS"}` on a narrow ingress rule skips the
    // sourceRanges check (absent list, not an insert) and passes the
    // destinationRanges check the same way — the rule changes meaning
    // with zero errors. Same shape as `disabled`.
    for (const body of [
      { direction: 'EGRESS' },
      { direction: 'egress', sourceRanges: ['10.0.0.0/8'] },
      { direction: 'INGRESS', destinationRanges: ['10.0.0.0/8'] },
    ]) {
      expect(validateGcpFirewallPatch(body, PREFIX, false).join(' ')).toMatch(
        /changing "direction"/,
      );
    }
  });

  it('refuses a priority rewrite on a patch', () => {
    // Priority decides which rule wins: lowering a broad ALLOW above a
    // DENY widens access without touching any range list — the same
    // enforcement rewrite as `disabled` or `direction`.
    expect(
      validateGcpFirewallPatch({ priority: 100 }, PREFIX, false).join(' '),
    ).toMatch(/changing "priority"/);
  });

  it('allows priority on an insert (declared with its range lists)', () => {
    expect(
      validateGcpFirewallPatch(
        {
          priority: 1000,
          sourceRanges: ['10.0.0.0/8'],
          allowed: [{ IPProtocol: 'tcp', ports: ['443'] }],
        },
        PREFIX,
        true,
      ),
    ).toEqual([]);
  });

  it('allows direction on an insert (declared with its range lists)', () => {
    expect(
      validateGcpFirewallPatch(
        {
          direction: 'EGRESS',
          destinationRanges: ['10.0.0.0/8'],
          allowed: [{ IPProtocol: 'tcp', ports: ['443'] }],
        },
        PREFIX,
        true,
      ),
    ).toEqual([]);
  });
});

describe('validateGcpFirewallPatch numeric protocols', () => {
  it('refuses numeric "6"/"17" without ports like their named twins', () => {
    // GCP accepts protocol numbers: "6" is TCP, "17" is UDP. A numeric
    // spelling without ports opens every port exactly like "tcp" does.
    for (const IPProtocol of ['6', '17', ' 6 ']) {
      expect(
        validateGcpFirewallPatch(
          { sourceRanges: ['10.0.0.0/8'], allowed: [{ IPProtocol }] },
          PREFIX,
          false,
        ).join(' '),
      ).toMatch(/without ports/);
    }
  });

  it('refuses numeric "6" with a full port range', () => {
    expect(
      validateGcpFirewallPatch(
        {
          sourceRanges: ['10.0.0.0/8'],
          allowed: [{ IPProtocol: '17', ports: ['0-65535'] }],
        },
        PREFIX,
        false,
      ).join(' '),
    ).toMatch(/full 0-65535/);
  });

  it('allows numeric "6" with narrow ports', () => {
    expect(
      validateGcpFirewallPatch(
        {
          sourceRanges: ['10.0.0.0/8'],
          allowed: [{ IPProtocol: '6', ports: ['443'] }],
        },
        PREFIX,
        false,
      ),
    ).toEqual([]);
  });

  it('treats a JSON-number protocol like its string spelling', () => {
    const open = validateGcpFirewallPatch(
      { sourceRanges: ['10.0.0.0/8'], allowed: [{ IPProtocol: 6 }] },
      PREFIX,
      false,
    );
    expect(open.join(' ')).toMatch(/without ports/);
    expect(
      validateGcpFirewallPatch(
        {
          sourceRanges: ['10.0.0.0/8'],
          allowed: [{ IPProtocol: 6, ports: ['443'] }],
        },
        PREFIX,
        false,
      ),
    ).toEqual([]);
  });

  it('refuses numeric TCP/UDP through dispatch (end to end)', () => {
    const COLLECTION =
      'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls';
    const errors = validateGcpWriteStepParams(
      fixStep({
        url: `${COLLECTION}/f`,
        body: {
          sourceRanges: ['10.0.0.0/8'],
          allowed: [{ IPProtocol: '6' }],
        },
      }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/without ports/);
  });
});

describe('validateGcpFirewallPatch cross-entry port union', () => {
  it('refuses the full range split across sibling entries', () => {
    const errors = validateGcpFirewallPatch(
      {
        sourceRanges: ['10.0.0.0/8'],
        allowed: [
          { IPProtocol: 'tcp', ports: ['0-32767'] },
          { IPProtocol: 'tcp', ports: ['32768-65535'] },
        ],
      },
      PREFIX,
      false,
    );
    expect(errors.join(' ')).toMatch(/across sibling rules/);
  });

  it('refuses split halves under mixed numeric and named spellings', () => {
    const errors = validateGcpFirewallPatch(
      {
        sourceRanges: ['10.0.0.0/8'],
        allowed: [
          { IPProtocol: '6', ports: ['0-32767'] },
          { IPProtocol: 'tcp', ports: ['32768-65535'] },
        ],
      },
      PREFIX,
      false,
    );
    expect(errors.join(' ')).toMatch(/across sibling rules/);
  });

  it('allows halves split across protocols (neither opens fully)', () => {
    expect(
      validateGcpFirewallPatch(
        {
          sourceRanges: ['10.0.0.0/8'],
          allowed: [
            { IPProtocol: 'tcp', ports: ['0-32767'] },
            { IPProtocol: 'udp', ports: ['32768-65535'] },
          ],
        },
        PREFIX,
        false,
      ),
    ).toEqual([]);
  });
});

describe('validateGcpFirewallPatch merge without allowed', () => {
  const RULE_URL =
    'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls/f';
  const READ = {
    method: 'GET',
    url: RULE_URL,
    purpose: 'read',
  } as Parameters<typeof validateGcpWriteStepParams>[0];

  function patchWithoutAllowed(
    realState?: Record<string, unknown>,
  ): ReturnType<typeof validateGcpFirewallPatch> {
    const step = fixStep({
      method: 'PATCH',
      url: RULE_URL,
      body: { sourceRanges: ['10.0.0.0/8'] },
    });
    const viaDispatch = validateGcpWriteStepParams(step, {
      ...(realState ? { realState } : {}),
      readSteps: [READ],
      index: 0,
    });
    return viaDispatch;
  }

  it('allows a merge that keeps a narrow stored allowed list', () => {
    expect(
      patchWithoutAllowed({
        read: {
          allowed: [{ IPProtocol: 'tcp', ports: ['443'] }],
        },
      }),
    ).toEqual([]);
  });

  it('refuses a merge without read state (stored list is unproven)', () => {
    expect(patchWithoutAllowed().join(' ')).toMatch(
      /leaves the stored list unproven/,
    );
  });

  it('refuses a merge when the stored list opens every port', () => {
    expect(
      patchWithoutAllowed({
        read: {
          allowed: [{ IPProtocol: 'tcp', ports: ['0-65535'] }],
        },
      }).join(' '),
    ).toMatch(/leaves the stored list unproven/);
  });
});

describe('validateGcpFirewallPatch full-replace without lists', () => {
  const RULE_URL =
    'https://compute.googleapis.com/compute/v1/projects/p/global/firewalls/f';

  it('refuses a PUT replace without sourceRanges', () => {
    // PUT to a named rule is a full replace: omitted ranges reset to open
    // defaults, so a missing list is an open rule, not a no-op.
    const errors = validateGcpFirewallPatch({}, PREFIX, false, {
      isReplace: true,
    });
    expect(errors.join(' ')).toMatch(/create\/replace without sourceRanges/);
  });

  it('refuses a PUT replace without allowed', () => {
    // Replace resets the protocol list instead of keeping stored values,
    // so prior state proves nothing — refuse outright.
    const errors = validateGcpFirewallPatch(
      { sourceRanges: ['10.0.0.0/8'] },
      PREFIX,
      false,
      { isReplace: true },
    );
    expect(errors.join(' ')).toMatch(/full-replace without "allowed"/);
  });

  it('allows a PUT replace with narrow ranges and ports', () => {
    expect(
      validateGcpFirewallPatch(
        {
          sourceRanges: ['10.0.0.0/8'],
          allowed: [{ IPProtocol: 'tcp', ports: ['443'] }],
        },
        PREFIX,
        false,
        { isReplace: true },
      ),
    ).toEqual([]);
  });

  it('routes PUT to a named rule through the replace gates', () => {
    // The dispatcher must mark PUT-to-named-path as a replace: without
    // the flag the missing lists skip every gate and return [].
    const errors = validateGcpWriteStepParams(
      fixStep({ method: 'PUT', url: RULE_URL, body: {} }),
      { index: 0 },
    );
    expect(errors.join(' ')).toMatch(/create\/replace without sourceRanges/);
  });
});
