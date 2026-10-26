import type { ReactNode } from "react";
const LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const CODE_PATTERN = /`([^`]+)`/g;
const BOLD_PATTERN = /\*\*([^*]+)\*\*/g;
const ITALIC_PATTERN = /\*([^*]+)\*/g;
function parseInline(text: string, keyPrefix: string): ReactNode[] {
  if (!text) return [];
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  const patterns: Array<{
    regex: RegExp;
    render: (match: RegExpExecArray) => ReactNode;
  }> = [
    {
      regex: LINK_PATTERN,
      render: (match) => (
        <a
          key={`${keyPrefix}-link-${key++}`}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:text-primary/80"
        >
          {match[1]}
        </a>
      ),
    },
    {
      regex: CODE_PATTERN,
      render: (match) => (
        <code
          key={`${keyPrefix}-code-${key++}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {match[1]}
        </code>
      ),
    },
    {
      regex: BOLD_PATTERN,
      render: (match) => (
        <strong key={`${keyPrefix}-bold-${key++}`} className="font-semibold text-foreground">
          {match[1]}
        </strong>
      ),
    },
    {
      regex: ITALIC_PATTERN,
      render: (match) => (
        <em key={`${keyPrefix}-italic-${key++}`} className="italic">
          {match[1]}
        </em>
      ),
    },
  ];
  while (cursor < text.length) {
    let earliestMatch: RegExpExecArray | null = null;
    let earliestPattern: (typeof patterns)[number] | null = null;
    for (const pattern of patterns) {
      pattern.regex.lastIndex = cursor;
      const match = pattern.regex.exec(text);
      if (!match) continue;
      if (!earliestMatch || match.index < earliestMatch.index) {
        earliestMatch = match;
        earliestPattern = pattern;
      }
    }
    if (!earliestMatch || !earliestPattern) {
      nodes.push(text.slice(cursor));
      break;
    }
    if (earliestMatch.index > cursor) {
      nodes.push(text.slice(cursor, earliestMatch.index));
    }
    nodes.push(earliestPattern.render(earliestMatch));
    cursor = earliestMatch.index + earliestMatch[0].length;
  }
  return nodes;
}
function parseListItem(line: string): { ordered: boolean; content: string } | null {
  const ordered = line.match(/^(\d+)\.\s+(.+)$/);
  if (ordered) return { ordered: true, content: ordered[2] };
  const bullet = line.match(/^[-*]\s+(.+)$/);
  if (bullet) return { ordered: false, content: bullet[1] };
  return null;
}
export function renderSimpleMarkdown(text: string): ReactNode {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const listItem = parseListItem(line);
    if (listItem) {
      const ordered = listItem.ordered;
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const current = parseListItem(lines[index]);
        if (!current || current.ordered !== ordered) break;
        items.push(
          <li key={`item-${index}`} className="leading-relaxed">
            {parseInline(current.content, `line-${index}`)}
          </li>,
        );
        index += 1;
      }
      blocks.push(
        ordered ? (
          <ol key={`ol-${index}`} className="my-2 list-decimal space-y-1 pl-5">
            {items}
          </ol>
        ) : (
          <ul key={`ul-${index}`} className="my-2 list-disc space-y-1 pl-5">
            {items}
          </ul>
        ),
      );
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const currentLine = lines[index];
      if (!currentLine.trim() || parseListItem(currentLine)) break;
      paragraphLines.push(currentLine);
      index += 1;
    }
    blocks.push(
      <p key={`p-${index}`} className="leading-relaxed">
        {paragraphLines.map((paragraphLine, lineIndex) => (
          <span key={`p-${index}-${lineIndex}`}>
            {lineIndex > 0 ? <br /> : null}
            {parseInline(paragraphLine, `p-${index}-${lineIndex}`)}
          </span>
        ))}
      </p>,
    );
  }
  return <>{blocks}</>;
}