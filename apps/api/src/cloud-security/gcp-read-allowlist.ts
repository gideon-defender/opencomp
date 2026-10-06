import { gcpAllowlistedApiHosts } from './gcp-remediation-prompt-allowlist';
import { decodeGcpPathToFixedPoint } from './gcp-remediation-step-url';

/**
 * Hosts a read step may target.
 *
 * Reads run with the auditor token before any allowlist-gated write, so a
 * read to an arbitrary `*.googleapis.com` host is recon with a privileged
 * bearer. Reads stay read-only (GET, plus POST for `:getIamPolicy` which
 * has no GET form), and the host must be one the system prompt documents:
 * every fix host, plus the read-only hosts the prompt uses for state
 * (`cloudresourcemanager` for IAM reads, `logging`/`container` for
 * guided-only state reads, `iam` for service-account reads).
 */
const EXTRA_READ_HOSTS = [
  'cloudresourcemanager.googleapis.com',
  'logging.googleapis.com',
  'container.googleapis.com',
  'iam.googleapis.com',
] as const;

function readAllowedHosts(): Set<string> {
  const hosts = gcpAllowlistedApiHosts();
  for (const host of EXTRA_READ_HOSTS) hosts.add(host);
  return hosts;
}

/** True when a read-step URL targets an allowed read host over HTTPS. */
export function isGcpReadAllowedUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return readAllowedHosts().has(parsed.hostname.toLowerCase());
}

/**
 * True when a read step uses a read-only shape: GET anywhere, or POST to
 * `:getIamPolicy` (IAM reads have no GET form — the executor upgrades them
 * to v3 and injects `requestedPolicyVersion: 3`).
 */
export function isGcpReadOnlyMethod(args: {
  method: string;
  url: string;
}): boolean {
  if (args.method === 'GET') return true;
  if (args.method !== 'POST') return false;
  try {
    // Fixed-point decode (same function the allowlist normalizer uses):
    // a single decode reads `%253AgetIamPolicy` as non-IAM while the
    // guards see IAM — the exemption must agree with them. Trailing
    // slashes strip first to match `isGetIamPolicyUrl`: without this a
    // `...:getIamPolicy/` read is refused here but treated as the same
    // IAM read everywhere else.
    const decoded = decodeGcpPathToFixedPoint(new URL(args.url).pathname);
    return (
      decoded !== undefined &&
      decoded.replace(/\/+$/, '').endsWith(':getIamPolicy')
    );
  } catch {
    // Undecodable pathnames fail closed: falling back to a raw substring
    // check would let `.../x%ZZ?x=:getIamPolicy` smuggle a POST write into
    // pre-acknowledgment reads.
    return false;
  }
}
