/**
 * IPv4/IPv6 CIDR parsing and full-space coverage for GCP guardrails.
 *
 * Split from `gcp-remediation-validator-shared` to respect the 300-line
 * repo limit. Every unparseable entry fails closed (refuse): a range the
 * guard cannot understand is not a range it can approve.
 */

function parseIpv4Cidr(value: string): [number, number] | undefined {
  const segments = value.split('/');
  // More than one `/` is not a CIDR at all — fail closed instead of
  // silently trusting the leading half (e.g. `10.0.0.0/8/evil` parsing
  // as a narrow `10/8` and passing the open-range check).
  if (segments.length > 2) return undefined;
  const [ip, bits = '32'] = segments;
  const octets = ip.split('.');
  if (octets.length !== 4) return undefined;
  let addr = 0;
  for (const octet of octets) {
    if (!/^\d+$/.test(octet)) return undefined;
    const n = Number(octet);
    if (n < 0 || n > 255) return undefined;
    addr = addr * 256 + n;
  }
  if (!/^\d+$/.test(bits)) return undefined;
  const prefix = Number(bits);
  if (prefix < 0 || prefix > 32) return undefined;
  const size = 2 ** (32 - prefix);
  const start = Math.floor(addr / size) * size;
  return [start, start + size - 1];
}

function parseIpv6Cidr(value: string): [bigint, bigint] | undefined {
  const segments = value.split('/');
  // Same fail-closed rule as IPv4: `addr/prefix/trailing` is malformed
  // and must refuse, never parse as the leading half.
  if (segments.length > 2) return undefined;
  const [addr, bits = '128'] = segments;
  if (!/^\d+$/.test(bits)) return undefined;
  const prefix = Number(bits);
  if (prefix < 0 || prefix > 128) return undefined;
  const halves = addr.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && head.length !== 8) return undefined;
  if (head.length + tail.length > 8) return undefined;
  const parts = [...head];
  while (parts.length + tail.length < 8) parts.push('0');
  parts.push(...tail);
  let net = 0n;
  for (const part of parts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return undefined;
    net = (net << 16n) + BigInt(parseInt(part, 16));
  }
  const full = (1n << 128n) - 1n;
  const mask = (full << BigInt(128 - prefix)) & full;
  const start = net & mask;
  return [start, start | (full ^ mask)];
}

function coversFullSpace(
  intervals: Array<[number, number]>,
  max: number,
): boolean {
  intervals.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  for (const [start, end] of intervals) {
    if (start > covered) return false;
    covered = Math.max(covered, end + 1);
    if (covered > max) return true;
  }
  return covered > max;
}

function coversFullSpaceBig(
  intervals: Array<[bigint, bigint]>,
  max: bigint,
): boolean {
  intervals.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let covered = 0n;
  for (const [start, end] of intervals) {
    if (start > covered) return false;
    if (end + 1n > covered) covered = end + 1n;
    if (covered > max) return true;
  }
  return covered > max;
}

/**
 * True when a range list exposes the full IP space — the exact open range,
 * split halves (`0.0.0.0/1` + `128.0.0.0/1`, `::/1` + `8000::/1`), or any
 * covering union, in IPv4 or IPv6. Entries are trimmed before matching so
 * padded open ranges cannot slip through. Unparseable and non-string
 * entries fail closed (refuse): a range the guard cannot understand is
 * not a range it can approve.
 */
export function rangesExposeFullIpSpace(values: unknown): boolean {
  if (!Array.isArray(values)) return false;
  const v4: Array<[number, number]> = [];
  const v6: Array<[bigint, bigint]> = [];
  for (const entry of values) {
    if (typeof entry !== 'string') return true;
    const value = entry.trim();
    if (value.length === 0) return true;
    if (value === '0.0.0.0/0' || value === '::/0') return true;
    if (value.includes(':')) {
      const parsed = parseIpv6Cidr(value);
      if (!parsed) return true;
      v6.push(parsed);
      continue;
    }
    const parsed = parseIpv4Cidr(value);
    if (!parsed) return true;
    v4.push(parsed);
  }
  return (
    coversFullSpace(v4, 0xffffffff) || coversFullSpaceBig(v6, (1n << 128n) - 1n)
  );
}
