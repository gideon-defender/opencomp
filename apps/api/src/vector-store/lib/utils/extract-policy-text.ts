import type { Policy } from '@db';

/**
 * Extracts plain text from a TipTap JSON policy content
 * Handles various TipTap node types: paragraphs, headings, lists, etc.
 * @param policy - The policy object with TipTap JSON content
 * @returns Plain text representation of the policy
 */
export function extractTextFromPolicy(policy: Policy): string {
  if (!policy.content || !Array.isArray(policy.content)) {
    return '';
  }

  const textParts: string[] = [];

  // Add policy name and description if available
  if (policy.name) {
    textParts.push(`Policy: ${policy.name}`);
  }
  if (policy.description) {
    textParts.push(`Description: ${policy.description}`);
  }

  // Process TipTap JSON content
  const processNode = (node: unknown): string => {
    if (typeof node !== 'object' || node === null) {
      return '';
    }

    const record = node as Record<string, unknown>;
    const nodeType: unknown = record.type;
    const nodeText: unknown = record.text;
    const nodeContent: unknown = record.content;

    const parts: string[] = [];

    // Handle text nodes
    if (nodeType === 'text' && typeof nodeText === 'string') {
      return nodeText;
    }

    // Handle headings
    if (nodeType === 'heading' && Array.isArray(nodeContent)) {
      const headingText = nodeContent
        .map((child: unknown) => processNode(child))
        .join('');
      parts.push(headingText);
    }

    // Handle paragraphs
    if (nodeType === 'paragraph' && Array.isArray(nodeContent)) {
      const paraText = nodeContent
        .map((child: unknown) => processNode(child))
        .join('');
      if (paraText.trim()) {
        parts.push(paraText);
      }
    }

    // Handle bullet lists
    if (nodeType === 'bulletList' && Array.isArray(nodeContent)) {
      nodeContent.forEach((listItem: unknown) => {
        if (typeof listItem !== 'object' || listItem === null) return;
        const item = listItem as Record<string, unknown>;
        if (item.type === 'listItem' && Array.isArray(item.content)) {
          item.content.forEach((itemContent: unknown) => {
            const itemText = processNode(itemContent);
            if (itemText.trim()) {
              parts.push(`• ${itemText}`);
            }
          });
        }
      });
    }

    // Handle ordered lists
    if (nodeType === 'orderedList' && Array.isArray(nodeContent)) {
      let index = 1;
      nodeContent.forEach((listItem: unknown) => {
        if (typeof listItem !== 'object' || listItem === null) return;
        const item = listItem as Record<string, unknown>;
        if (item.type === 'listItem' && Array.isArray(item.content)) {
          item.content.forEach((itemContent: unknown) => {
            const itemText = processNode(itemContent);
            if (itemText.trim()) {
              parts.push(`${index}. ${itemText}`);
              index++;
            }
          });
        }
      });
    }

    // Handle other node types recursively
    if (Array.isArray(nodeContent)) {
      nodeContent.forEach((child: unknown) => {
        const childText = processNode(child);
        if (childText.trim()) {
          parts.push(childText);
        }
      });
    }

    return parts.join('\n');
  };

  // Process all content nodes
  policy.content.forEach((node: unknown) => {
    const nodeText = processNode(node);
    if (nodeText.trim()) {
      textParts.push(nodeText);
    }
  });

  return textParts.join('\n\n');
}
