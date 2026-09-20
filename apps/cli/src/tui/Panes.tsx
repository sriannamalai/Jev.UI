// The TUI's State and Questions panes, plus the `Frame` border shared by all
// three (spec §8.2). `Results.tsx` (13a) is the third pane's content.
import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import { DEFAULT_MODEL, estimateStateBudget, LIMITS, questionIds } from '@jev-ui/core';
import type { Question, Request } from '@jev-ui/core';
import { textOf, truncate } from './bars.js';

const MAX_STATE_LINES = 12;
const TOKEN_BUDGET = LIMITS.stateBudgetTokens.toLocaleString('en-US');
const NOUL_SUMMARY_LEN = 40;

/** A bordered pane. Focus is shown two ways so it survives `NO_COLOR`: a
 * `▌` prefix on the title always, and a cyan border only when `focused &&
 * color`. */
export function Frame(props: {
  title: string;
  focused: boolean;
  width: number;
  color: boolean;
  children?: ReactNode;
}) {
  const { title, focused, width, color, children } = props;
  const prefix = focused ? '▌ ' : '  ';
  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      {...(focused && color ? { borderColor: 'cyan' as const } : {})}
    >
      <Text>
        {prefix}
        {title}
      </Text>
      {children}
    </Box>
  );
}

export function StateView(props: { request: Request; width: number }) {
  const { request, width } = props;
  const text = textOf(request.state);
  const lines = text.length > 0 ? text.split('\n') : [''];
  const shown = lines.slice(0, MAX_STATE_LINES);
  const extra = lines.length - shown.length;
  const budget = estimateStateBudget(request);

  return (
    <Box flexDirection="column" width={width}>
      <Text>{truncate(`model: ${request.model ?? DEFAULT_MODEL}`, width)}</Text>
      {shown.map((line, index) => (
        <Text key={index}>{truncate(line, width)}</Text>
      ))}
      {extra > 0 && <Text>… {extra} more lines</Text>}
      <Text>
        ≈ {budget} / {TOKEN_BUDGET} tokens
      </Text>
    </Box>
  );
}

function questionSummary(question: Question): string {
  switch (question.type) {
    case 'choice':
      return `${Object.keys(question.criteria).length} options`;
    case 'score':
      return `${question.criteria.length} levels`;
    case 'noul':
      return truncate(textOf(question.instructions), NOUL_SUMMARY_LEN);
  }
}

// Detail lines are rendered with a 2-column indent prefix (see
// `QuestionsView` below), so they must be truncated to `width - 2` or the
// indent pushes them past the pane's right edge.
function questionDetails(question: Question, width: number): string[] {
  const detailWidth = Math.max(0, width - 2);
  const lines = [truncate(textOf(question.instructions), detailWidth)];
  if (question.type === 'choice') {
    for (const [key, value] of Object.entries(question.criteria)) {
      const description = value === null || value === undefined ? '' : textOf(value);
      lines.push(truncate(`${key} — ${description}`, detailWidth));
    }
  } else if (question.type === 'score') {
    question.criteria.forEach((level, index) => {
      lines.push(truncate(`${index} · ${textOf(level)}`, detailWidth));
    });
  }
  return lines;
}

export function QuestionsView(props: {
  request: Request;
  selectedId: string | undefined;
  width: number;
  color: boolean;
}) {
  const { request, selectedId, width, color } = props;
  const ids = questionIds(request);

  return (
    <Box flexDirection="column" width={width}>
      {ids.map((id) => {
        const question = request.questions[id];
        if (!question) return null;
        const selected = id === selectedId;
        const prefix = selected ? '▸ ' : '  ';
        const line = truncate(
          `${prefix}[${question.type}] ${id}  ${questionSummary(question)}`,
          width,
        );
        return (
          <Box key={id} flexDirection="column">
            <Text {...(selected && color ? { inverse: true as const } : {})}>{line}</Text>
            {selected &&
              questionDetails(question, width).map((detail, index) => (
                <Text key={index}>
                  {'  '}
                  {detail}
                </Text>
              ))}
          </Box>
        );
      })}
    </Box>
  );
}
