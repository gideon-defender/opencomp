import { quoteForSingleQuotedShell } from './remediation-script-safety';

/** Reverses quoteForSingleQuotedShell the way Bourne shell would. */
function shellUnquote(quoted: string): string {
  return quoted.slice(1, -1).replace(/'\\''/g, "'");
}

describe('quoteForSingleQuotedShell', () => {
  it('wraps a plain value in single quotes', () => {
    expect(quoteForSingleQuotedShell('arn:aws:s3:::example-bucket')).toBe(
      "'arn:aws:s3:::example-bucket'",
    );
  });

  it('escapes an embedded single quote so the shell cannot break out', () => {
    const hostile = `*'; touch /tmp/pwned; echo '`;
    const quoted = quoteForSingleQuotedShell(hostile);
    expect(quoted).toBe(`'*'\\''; touch /tmp/pwned; echo '\\'''`);
    // The shell sees one quoted word back — the payload round-trips.
    expect(shellUnquote(quoted)).toBe(hostile);
  });

  it('round-trips JSON policy documents with quotes inside string values', () => {
    const policy = JSON.stringify({
      Statement: [{ Resource: `weird'bucket` }],
    });
    expect(shellUnquote(quoteForSingleQuotedShell(policy))).toBe(policy);
  });

  it('quotes the empty string as an empty quoted word', () => {
    expect(quoteForSingleQuotedShell('')).toBe(`''`);
  });
});
