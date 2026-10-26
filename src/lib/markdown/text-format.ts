export type TextFormatAction = "bold" | "italic" | "code" | "link" | "bullet" | "ordered";
type FormatSpec = {
  before: string;
  after: string;
  placeholder?: string;
};
const FORMAT_SPECS: Record<Exclude<TextFormatAction, "bullet" | "ordered">, FormatSpec> = {
  bold: { before: "**", after: "**", placeholder: "bold text" },
  italic: { before: "*", after: "*", placeholder: "italic text" },
  code: { before: "`", after: "`", placeholder: "code" },
  link: { before: "[", after: "](https://)", placeholder: "link text" },
};
export function applyTextFormat(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  action: TextFormatAction,
): { value: string; selectionStart: number; selectionEnd: number } {
  if (action === "bullet" || action === "ordered") {
    return applyLinePrefix(value, selectionStart, selectionEnd, action === "bullet" ? "- " : "1. ");
  }
  const spec = FORMAT_SPECS[action];
  const selected = value.slice(selectionStart, selectionEnd) || spec.placeholder || "";
  const nextValue =
    value.slice(0, selectionStart) + spec.before + selected + spec.after + value.slice(selectionEnd);
  const nextStart = selectionStart + spec.before.length;
  const nextEnd = nextStart + selected.length;
  return {
    value: nextValue,
    selectionStart: nextStart,
    selectionEnd: nextEnd,
  };
}
function applyLinePrefix(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string,
): { value: string; selectionStart: number; selectionEnd: number } {
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const lineEndIndex = value.indexOf("\n", selectionEnd);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const formatted = lines
    .map((line, index) => {
      const trimmed = line.trimStart();
      if (!trimmed) return line;
      const leading = line.slice(0, line.length - trimmed.length);
      const numberedPrefix = `${index + 1}. `;
      const nextPrefix = prefix === "- " ? prefix : numberedPrefix;
      if (trimmed.startsWith(nextPrefix)) return line;
      return `${leading}${nextPrefix}${trimmed}`;
    })
    .join("\n");
  const nextValue = value.slice(0, lineStart) + formatted + value.slice(lineEnd);
  const delta = formatted.length - block.length;
  return {
    value: nextValue,
    selectionStart: selectionStart,
    selectionEnd: selectionEnd + delta,
  };
}