export function parseRoles(role: string | null | undefined): string[] {
  return (role ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}
