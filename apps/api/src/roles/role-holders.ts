import { allRoles } from '@gideon-defender/auth';
import { db, type Prisma } from '@db';
import { splitRoleString } from '../auth/app-access';

// Built-in role names. Single source for the roles module — import this
// instead of recomputing Object.keys(allRoles) per file.
export const BUILT_IN_ROLE_NAMES: string[] = Object.keys(allRoles);

/**
 * Split a comma-separated `member.role` value into exact tokens.
 * Single implementation shared with `splitRoleString` in auth/app-access:
 * the only difference is the empty case (`[]` here vs `null` there, where
 * `null` means "no membership row"). Matches the union semantics used by
 * enforcement: every entry is trimmed and empty entries are dropped.
 */
export function splitRoleNames(role: string | null | undefined): string[] {
  return splitRoleString(role) ?? [];
}

/**
 * Exact token membership (case-sensitive). Never use Prisma `contains`
 * here — `Lead` must not match `Compliance Lead`.
 */
export function hasExactRole(
  role: string | null | undefined,
  roleName: string,
): boolean {
  return splitRoleNames(role).includes(roleName);
}

/**
 * Count exact holders of one role from prefetched member rows.
 */
export function countExactMatches(
  members: Array<{ role: string | null }>,
  roleName: string,
): number {
  let count = 0;
  for (const member of members) {
    if (hasExactRole(member.role, roleName)) count += 1;
  }
  return count;
}

/**
 * Count exact holders for many roles in one pass over prefetched rows.
 */
export function countExactMatchesForRoles(
  members: Array<{ role: string | null }>,
  roleNames: string[],
): Map<string, number> {
  const counts = new Map(roleNames.map((name) => [name, 0]));
  for (const member of members) {
    const seen = new Set(splitRoleNames(member.role));
    for (const token of seen) {
      if (counts.has(token)) counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Exact holder counts for the given roles with paged member scans.
 * Replaces one `member.count({ contains })` per role (N+1 queries that
 * also overcounted substring matches such as `Lead` in `Compliance Lead`).
 * Pages in batches so large orgs never load every member row at once.
 */
export async function countHoldersForRoles(
  organizationId: string,
  roleNames: string[],
  client: Pick<Prisma.TransactionClient, 'member'> = db,
): Promise<Map<string, number>> {
  if (roleNames.length === 0) return new Map();
  const counts = new Map(roleNames.map((name) => [name, 0]));
  const pageSize = 1000;
  let cursor: string | undefined;
  for (;;) {
    const page = await client.member.findMany({
      where: { organizationId },
      select: { id: true, role: true },
      orderBy: { id: 'asc' },
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    const partial = countExactMatchesForRoles(page, roleNames);
    for (const [name, n] of partial) {
      counts.set(name, (counts.get(name) ?? 0) + n);
    }
    if (page.length < pageSize) break;
    cursor = page[page.length - 1].id;
  }
  return counts;
}

/**
 * Exact holder count for one role with a single member query.
 */
export async function countHoldersExact(
  organizationId: string,
  roleName: string,
  client: Pick<Prisma.TransactionClient, 'member'> = db,
): Promise<number> {
  const counts = await countHoldersForRoles(organizationId, [roleName], client);
  return counts.get(roleName) ?? 0;
}
