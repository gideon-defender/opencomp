import { rangesExposeFullIpSpace } from './gcp-remediation-ip-ranges';

describe('rangesExposeFullIpSpace', () => {
  it('flags the exact open ranges', () => {
    expect(rangesExposeFullIpSpace(['0.0.0.0/0'])).toBe(true);
    expect(rangesExposeFullIpSpace(['::/0'])).toBe(true);
  });

  it('flags split-half coverage in v4 and v6', () => {
    expect(rangesExposeFullIpSpace(['0.0.0.0/1', '128.0.0.0/1'])).toBe(true);
    expect(rangesExposeFullIpSpace(['::/1', '8000::/1'])).toBe(true);
  });

  it('flags covering unions, not just single ranges', () => {
    expect(
      rangesExposeFullIpSpace(['0.0.0.0/1', '128.0.0.0/2', '192.0.0.0/2']),
    ).toBe(true);
  });

  it('trims padding before matching open ranges', () => {
    expect(rangesExposeFullIpSpace(['  0.0.0.0/0  '])).toBe(true);
  });

  it('passes narrow ranges', () => {
    expect(rangesExposeFullIpSpace(['10.0.0.0/8'])).toBe(false);
    expect(rangesExposeFullIpSpace(['10.0.0.0/8', '192.168.0.0/16'])).toBe(
      false,
    );
    expect(rangesExposeFullIpSpace(['2001:db8::/32'])).toBe(false);
    expect(rangesExposeFullIpSpace([])).toBe(false);
    expect(rangesExposeFullIpSpace('not-an-array')).toBe(false);
  });

  it('fails closed on malformed entries', () => {
    // `10.0.0.0/8/evil` must not parse as the narrow leading half.
    expect(rangesExposeFullIpSpace(['10.0.0.0/8/evil'])).toBe(true);
    expect(rangesExposeFullIpSpace(['not-an-ip'])).toBe(true);
    expect(rangesExposeFullIpSpace(['10.0.0.0/33'])).toBe(true);
    expect(rangesExposeFullIpSpace([''])).toBe(true);
    expect(rangesExposeFullIpSpace([42])).toBe(true);
    expect(rangesExposeFullIpSpace(['2001:::db8/32'])).toBe(true);
  });
});
