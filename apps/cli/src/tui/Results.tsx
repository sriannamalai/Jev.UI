// The TUI's Results pane (spec §8): per-question answer blocks in request
// order, mirroring `apps/web`'s ResultsPane ordering/stale rules, rendered
// as text for a terminal via Ink instead of DOM.
import { Box, Text } from 'ink';
import { questionIds } from '@jev-ui/core';
import type {
  Answer,
  ChoiceAnswer,
  NoulAnswer,
  Request,
  RunResult,
  ScoreAnswer,
} from '@jev-ui/core';
import { bar } from '../format.js';
import {
  LOW_CONFIDENCE,
  displayWidth,
  fmt2,
  padEndDisplay,
  renderScale,
  textOf,
  truncate,
} from './bars.js';

const MAX_LABEL = 28;
const NUM_WIDTH = 4;
const GUTTERS = 4;
const MIN_BAR = 8;

interface Row {
  label: string;
  value: number;
}

interface TextStyle {
  inverse?: true;
  dimColor?: true;
  color?: string;
}

/** Only ever produces style props when `color` is enabled — with `color`
 * false the caller gets an empty object, so no colour/inverse/dim prop is
 * ever passed to Ink (spec: "NO_COLOR → no colour props"). */
function styleProps(
  color: boolean,
  opts: { inverse?: boolean; dim?: boolean; yellow?: boolean },
): TextStyle {
  if (!color) return {};
  const props: TextStyle = {};
  if (opts.inverse) props.inverse = true;
  if (opts.dim) props.dimColor = true;
  if (opts.yellow) props.color = 'yellow';
  return props;
}

function layout(labels: string[], width: number): { labelWidth: number; barWidth: number } {
  const raw = labels.length > 0 ? Math.max(...labels.map((l) => displayWidth(l))) : 0;
  const labelWidth = Math.min(raw, MAX_LABEL);
  const barWidth = Math.max(MIN_BAR, width - labelWidth - NUM_WIDTH - GUTTERS);
  return { labelWidth, barWidth };
}

function RowLine(props: {
  row: Row;
  labelWidth: number;
  barWidth: number;
  dim: boolean;
  color: boolean;
}) {
  const { row, labelWidth, barWidth, dim, color } = props;
  const label = padEndDisplay(truncate(row.label, labelWidth), labelWidth);
  const text = `${label}  ${bar(row.value, barWidth)}  ${fmt2(row.value)}`;
  return <Text {...styleProps(color, { dim })}>{text}</Text>;
}

function ConfidenceText(props: { confidence: number; color: boolean }) {
  const { confidence, color } = props;
  const low = Number.isFinite(confidence) && confidence < LOW_CONFIDENCE;
  const text = `conf ${fmt2(confidence)}${low ? ' !' : ''}`;
  return <Text {...styleProps(color, { yellow: low })}>{text}</Text>;
}

function Header(props: {
  prefix: string;
  before: string;
  confidence?: number;
  selected: boolean;
  dim: boolean;
  color: boolean;
}) {
  const { prefix, before, confidence, selected, dim, color } = props;
  return (
    <Text {...styleProps(color, { inverse: selected, dim })}>
      {prefix}
      {before}
      {confidence !== undefined && <ConfidenceText confidence={confidence} color={color} />}
    </Text>
  );
}

function ChoiceBlock(props: {
  id: string;
  answer: ChoiceAnswer;
  prefix: string;
  selected: boolean;
  dim: boolean;
  width: number;
  color: boolean;
}) {
  const { id, answer, prefix, selected, dim, width, color } = props;
  const rows: Row[] = Object.entries(answer.probabilities)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const { labelWidth, barWidth } = layout(
    rows.map((r) => r.label),
    width,
  );
  return (
    <Box flexDirection="column">
      <Header
        prefix={prefix}
        before={`CHOICE ${id}  ${answer.choice}  `}
        confidence={answer.confidence}
        selected={selected}
        dim={dim}
        color={color}
      />
      {rows.map((row) => (
        <RowLine
          key={row.label}
          row={row}
          labelWidth={labelWidth}
          barWidth={barWidth}
          dim={dim}
          color={color}
        />
      ))}
    </Box>
  );
}

function ScoreBlock(props: {
  id: string;
  answer: ScoreAnswer;
  prefix: string;
  selected: boolean;
  dim: boolean;
  width: number;
  color: boolean;
}) {
  const { id, answer, prefix, selected, dim, width, color } = props;
  const levels = Object.keys(answer.legend).sort((a, b) => Number(a) - Number(b));
  const nearestIndex = Math.min(
    Math.max(Math.round(answer.score), 0),
    Math.max(levels.length - 1, 0),
  );
  const nearestKey = levels[nearestIndex];
  const nearestLegend = nearestKey !== undefined ? textOf(answer.legend[nearestKey]) : '';

  const rows: Row[] = levels.map((level) => ({
    label: `${level} · ${textOf(answer.legend[level])}`,
    value: answer.probabilities[level] ?? 0,
  }));
  const { labelWidth, barWidth } = layout(
    rows.map((r) => r.label),
    width,
  );

  return (
    <Box flexDirection="column">
      <Header
        prefix={prefix}
        before={`SCORE ${id}  ${fmt2(answer.score)}  ${nearestLegend}  `}
        confidence={answer.confidence}
        selected={selected}
        dim={dim}
        color={color}
      />
      <Text {...styleProps(color, { dim })}>
        {renderScale(answer.score, levels.length, barWidth)}
      </Text>
      {rows.map((row) => (
        <RowLine
          key={row.label}
          row={row}
          labelWidth={labelWidth}
          barWidth={barWidth}
          dim={dim}
          color={color}
        />
      ))}
    </Box>
  );
}

function NoulBlock(props: {
  id: string;
  answer: NoulAnswer;
  prefix: string;
  selected: boolean;
  dim: boolean;
  width: number;
  color: boolean;
}) {
  const { id, answer, prefix, selected, dim, width, color } = props;
  const word = Number.isFinite(answer.noul) && answer.noul >= 0.5 ? 'yes' : 'no';
  const rows: Row[] = [{ label: 'P(yes)', value: answer.noul }];
  const { labelWidth, barWidth } = layout(
    rows.map((r) => r.label),
    width,
  );

  return (
    <Box flexDirection="column">
      <Header
        prefix={prefix}
        before={`NOUL ${id}  ${fmt2(answer.noul)}  ${word}`}
        selected={selected}
        dim={dim}
        color={color}
      />
      {rows.map((row) => (
        <RowLine
          key={row.label}
          row={row}
          labelWidth={labelWidth}
          barWidth={barWidth}
          dim={dim}
          color={color}
        />
      ))}
    </Box>
  );
}

function Block(props: {
  id: string;
  answer: Answer;
  selected: boolean;
  stale: boolean;
  width: number;
  color: boolean;
}) {
  const { id, answer, selected, stale, width, color } = props;
  const prefix = selected ? '▸ ' : '  ';
  switch (answer.type) {
    case 'choice':
      return (
        <ChoiceBlock
          id={id}
          answer={answer}
          prefix={prefix}
          selected={selected}
          dim={stale}
          width={width}
          color={color}
        />
      );
    case 'score':
      return (
        <ScoreBlock
          id={id}
          answer={answer}
          prefix={prefix}
          selected={selected}
          dim={stale}
          width={width}
          color={color}
        />
      );
    case 'noul':
      return (
        <NoulBlock
          id={id}
          answer={answer}
          prefix={prefix}
          selected={selected}
          dim={stale}
          width={width}
          color={color}
        />
      );
  }
}

export function ResultsView(props: {
  request: Request;
  result: RunResult | undefined;
  stale: boolean;
  running: boolean;
  selectedId: string | undefined;
  width: number;
  color: boolean;
}) {
  const { request, result, stale, running, selectedId, width, color } = props;

  if (!result && !running) {
    return (
      <Box flexDirection="column" width={width}>
        <Text>Run the request (r) to see answers here.</Text>
      </Box>
    );
  }

  const blocks: { id: string; answer: Answer }[] = [];
  if (result) {
    for (const id of questionIds(request)) {
      if (!Object.hasOwn(result.answers, id)) continue;
      const answer = result.answers[id];
      if (answer) blocks.push({ id, answer });
    }
  }

  return (
    <Box flexDirection="column" width={width}>
      {running && <Text>Running…</Text>}
      {stale && <Text {...styleProps(color, { dim: true })}>stale — request changed</Text>}
      {blocks.map(({ id, answer }, index) => (
        <Box key={id} flexDirection="column" marginTop={index > 0 ? 1 : 0}>
          <Block
            id={id}
            answer={answer}
            selected={id === selectedId}
            stale={stale}
            width={width}
            color={color}
          />
        </Box>
      ))}
    </Box>
  );
}
