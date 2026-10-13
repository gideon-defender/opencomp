function isWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}

function findTagEnd({ html, start }: { html: string; start: number }): number {
  let quote: string | undefined;
  for (let cursor = start + 1; cursor < html.length; cursor += 1) {
    const char = html[cursor];
    if (quote) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return cursor;
    }
  }
  return -1;
}

/** Advance each cursor once so malformed tags and whitespace cannot cause backtracking. */
export function rewriteAnchorHrefs({
  html,
  rewriteHref,
}: {
  html: string;
  rewriteHref: (href: string) => string;
}): string {
  const parts: string[] = [];
  let copiedThrough = 0;
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start < 0) break;
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      if (end < 0) break;
      cursor = end + 3;
      continue;
    }
    const end = findTagEnd({ html, start });
    if (end < 0) break;
    cursor = end + 1;
    if (html[start + 1]?.toLowerCase() !== 'a' || !isWhitespace(html[start + 2])) {
      continue;
    }

    let attributeCursor = start + 2;
    while (attributeCursor < end) {
      while (isWhitespace(html[attributeCursor])) attributeCursor += 1;
      const nameStart = attributeCursor;
      while (attributeCursor < end) {
        const char = html[attributeCursor];
        if (
          isWhitespace(char) ||
          char === '=' ||
          char === '/' ||
          char === '<' ||
          char === '"' ||
          char === "'"
        )
          break;
        attributeCursor += 1;
      }
      if (attributeCursor === nameStart) break;
      const name = html.slice(nameStart, attributeCursor).toLowerCase();
      while (isWhitespace(html[attributeCursor])) attributeCursor += 1;
      if (html[attributeCursor] !== '=') continue;
      attributeCursor += 1;
      while (isWhitespace(html[attributeCursor])) attributeCursor += 1;
      const quote = html[attributeCursor];
      if (quote !== '"' && quote !== "'") {
        while (attributeCursor < end && !isWhitespace(html[attributeCursor])) attributeCursor += 1;
        continue;
      }
      attributeCursor += 1;
      const valueStart = attributeCursor;
      while (attributeCursor < end && html[attributeCursor] !== quote) attributeCursor += 1;
      if (attributeCursor >= end) break;
      if (name === 'href') {
        const href = html.slice(valueStart, attributeCursor);
        const rewritten = rewriteHref(href);
        if (rewritten !== href) {
          parts.push(html.slice(copiedThrough, valueStart), rewritten);
          copiedThrough = attributeCursor;
        }
      }
      attributeCursor += 1;
    }
  }
  parts.push(html.slice(copiedThrough));
  return parts.join('');
}
