/**
 * Extract mentioned user IDs from TipTap JSON content
 */
export function extractMentionedUserIds(description: string | null): string[] {
  if (!description) return [];

  try {
    const parsed =
      typeof description === 'string' ? JSON.parse(description) : description;

    if (!parsed || typeof parsed !== 'object') return [];

    const mentionedUserIds: string[] = [];

    // Recursively traverse the TipTap JSON structure
    function traverse(node: unknown) {
      if (typeof node !== 'object' || node === null) return;
      const record = node as Record<string, unknown>;

      // Check if this is a mention node
      if (record.type === 'mention') {
        const attrs: unknown = record.attrs;
        if (typeof attrs === 'object' && attrs !== null) {
          const id: unknown = (attrs as Record<string, unknown>).id;
          if (typeof id === 'string' && id) {
            mentionedUserIds.push(id);
          } else if (typeof id === 'number' && Number.isFinite(id)) {
            mentionedUserIds.push(String(id));
          }
        }
      }

      // Traverse content array
      if (Array.isArray(record.content)) {
        record.content.forEach(traverse);
      }
    }

    traverse(parsed);

    // Return unique user IDs
    return [...new Set(mentionedUserIds)];
  } catch {
    // If parsing fails, return empty array
    return [];
  }
}
