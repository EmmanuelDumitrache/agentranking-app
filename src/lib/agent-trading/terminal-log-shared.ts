export type TerminalLogChannel =
  | "sys"
  | "cmd"
  | "exec"
  | "trade"
  | "copy"
  | "schedule"
  | "wallet"
  | "chat"
  | "err";

export type TerminalLogLineDto = {
  id: string;
  at: string;
  channel: TerminalLogChannel;
  text: string;
};

export function formatTerminalLogTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

export function formatTerminalLogLine(line: TerminalLogLineDto): string {
  const ts = formatTerminalLogTimestamp(line.at);
  const channel = line.channel.padEnd(8, " ");
  return `${ts}  [${channel}] ${line.text}`;
}

export function sortTerminalLogLines(
  lines: readonly TerminalLogLineDto[],
): TerminalLogLineDto[] {
  return [...lines].sort(
    (left, right) => new Date(left.at).getTime() - new Date(right.at).getTime(),
  );
}

export function dedupeTerminalLogLines(
  lines: readonly TerminalLogLineDto[],
): TerminalLogLineDto[] {
  const seen = new Set<string>();
  const out: TerminalLogLineDto[] = [];
  for (const line of lines) {
    const key = `${line.at}:${line.channel}:${line.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}
