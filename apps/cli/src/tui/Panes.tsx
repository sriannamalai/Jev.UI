// The TUI's State and Questions panes, plus the `Frame` border shared by all
// three. `Results.tsx` is the third pane's content.
import type { ReactNode } from 'react';
import { Box, Text } from 'ink';
import { DEFAULT_MODEL, estimateStateBudget, LIMITS, questionIds } from '@jev-ui/core';
import type { Question, Request } from '@jev-ui/core';
import { textOf, truncate } from './bars.js';
import { Viewport, wrapDisplayText } from './Viewport.js';
import type { ViewportRow } from './Viewport.js';

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
  height?: number;
  children?: ReactNode;
}) {
  const { title, focused, width, color, height, children } = props;
  const prefix = focused ? '▌ ' : '  ';
  const titleLine = truncate(`${prefix}${title}`, Math.max(0, width - 2));
  return (
    <Box
      flexDirection="column"
      width={width}
      {...(height === undefined
        ? {}
        : { height: Math.max(3, Math.floor(height)), overflow: 'hidden' as const })}
      borderStyle="round"
      {...(focused && color ? { borderColor: 'cyan' as const } : {})}
    >
      <Text>{titleLine}</Text>
      {children}
    </Box>
  );
}

export function StateView(props: {
  request: Request;
  width: number;
  height?: number;
  active?: boolean;
}) {
  const { request, width, height, active = false } = props;
  const text = textOf(request.state);
  const budget = estimateStateBudget(request);
  const model = request.model ?? DEFAULT_MODEL;
  const strings = [
    ...wrapDisplayText(`model: ${model}`, width),
    ...wrapDisplayText(text, width),
    ...wrapDisplayText(`≈ ${budget} / ${TOKEN_BUDGET} tokens`, width),
  ];
  const rows: ViewportRow[] = strings.map((line, index) => ({
    key: `state-${index}`,
    content: <Text>{line}</Text>,
  }));

  return (
    <Viewport
      rows={rows}
      width={width}
      height={height}
      active={active}
      contentKey={`${width}:${model}:${text}:${budget}`}
    />
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
  const lines = wrapDisplayText(textOf(question.instructions), detailWidth);
  if (question.type === 'choice') {
    for (const [key, value] of Object.entries(question.criteria)) {
      const description = value === null || value === undefined ? '' : textOf(value);
      lines.push(...wrapDisplayText(`${key} — ${description}`, detailWidth));
    }
  } else if (question.type === 'score') {
    question.criteria.forEach((level, index) => {
      lines.push(...wrapDisplayText(`${index} · ${textOf(level)}`, detailWidth));
    });
  }
  return lines;
}

export function QuestionsView(props: {
  request: Request;
  selectedId: string | undefined;
  width: number;
  color: boolean;
  height?: number;
  active?: boolean;
  onSelect?(id: string): void;
}) {
  const { request, selectedId, width, color, height, active = false, onSelect } = props;
  const ids = questionIds(request);
  const rows: ViewportRow[] = [];

  for (const id of ids) {
    const question = request.questions[id];
    if (!question) continue;
    const selected = id === selectedId;
    const prefix = selected ? '▸ ' : '  ';
    const line = truncate(`${prefix}[${question.type}] ${id}  ${questionSummary(question)}`, width);
    rows.push({
      key: `${id}-header`,
      selectionId: id,
      content: <Text {...(selected && color ? { inverse: true as const } : {})}>{line}</Text>,
    });
    if (selected) {
      questionDetails(question, width).forEach((detail, index) => {
        rows.push({
          key: `${id}-detail-${index}`,
          selectionId: id,
          content: (
            <Text>
              {'  '}
              {detail}
            </Text>
          ),
        });
      });
    }
  }

  return (
    <Viewport
      rows={rows}
      width={width}
      height={height}
      active={active}
      contentKey={`${width}:${JSON.stringify(request.questions)}`}
      selectedId={selectedId}
      onSelect={onSelect}
      selectionNavigation={true}
    />
  );
}
