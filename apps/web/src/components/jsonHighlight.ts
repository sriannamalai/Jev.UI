// Locates the line range of one question's entry inside the JSON pane's
// serialised text, so the pane can highlight whichever question is selected
// in the form. Only understands the shape `serializeRequest` actually
// produces (2-space `JSON.stringify`, questions as a direct child of the
// top-level object) — hand-formatted or differently-indented JSON simply
// yields no match, which the caller treats as "no highlight".
export interface LineRange {
  fromLine: number;
  toLine: number;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A direct child of `questions` in the 2-space serialisation is indented by
// exactly 4 spaces (2 for `questions`, 2 more for the child).
const CHILD_INDENT = '    ';

export function findQuestionRange(jsonText: string, id: string): LineRange | undefined {
  const escapedId = escapeRegExp(JSON.stringify(id).slice(1, -1));
  const keyPattern = new RegExp(`^${CHILD_INDENT}"${escapedId}": `);

  const lines = jsonText.split('\n');
  const fromIndex = lines.findIndex((line) => keyPattern.test(line));
  if (fromIndex === -1) return undefined;

  let depth = 0;
  let hadOpened = false;
  let inString = false;
  let escaped = false;

  for (let lineIndex = fromIndex; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? '';
    for (const char of line) {
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{' || char === '[') {
        depth++;
        hadOpened = true;
      } else if (char === '}' || char === ']') {
        depth--;
      }
    }

    if (!hadOpened) {
      // A single-line, bracket-free value (string/number/bool/null) ends on
      // the line it started on.
      return { fromLine: fromIndex + 1, toLine: lineIndex + 1 };
    }
    if (depth === 0) {
      return { fromLine: fromIndex + 1, toLine: lineIndex + 1 };
    }
  }

  // Ran off the end of the document without the brackets balancing —
  // malformed/truncated JSON. No sensible range to report.
  return undefined;
}
