// The TUI's Results pane: per-question answer blocks in request order,
// mirroring the web workbench's ordering and stale rules.
import { Text } from 'ink';
import { questionIds } from '@jev-ui/core';
import type { Answer, Request, RunResult } from '@jev-ui/core';
import { bar } from '../format.js';
import { LOW_CONFIDENCE, displayWidth, fmt2, padEndDisplay, renderScale, textOf } from './bars.js';
import { Viewport, wrapDisplayText } from './Viewport.js';
import type { ViewportRow } from './Viewport.js';

const MAX_LABEL = 28;
const NUM_WIDTH = 4;
const GUTTERS = 4;
const MIN_BAR = 8;

interface ProbabilityRow {
  label: string;
  value: number;
}
interface TextStyle {
  inverse?: true;
  dimColor?: true;
  color?: string;
}

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
  const raw = labels.length > 0 ? Math.max(...labels.map(displayWidth)) : 0;
  const availableLabel = Math.max(1, width - MIN_BAR - NUM_WIDTH - GUTTERS);
  const labelWidth = Math.max(1, Math.min(raw, MAX_LABEL, availableLabel));
  const barWidth = Math.max(1, width - labelWidth - NUM_WIDTH - GUTTERS);
  return { labelWidth, barWidth };
}

function headerRows(
  keyPrefix: string,
  text: string,
  answerId: string,
  width: number,
  color: boolean,
  selected: boolean,
  dim: boolean,
  lowConfidence = false,
): ViewportRow[] {
  return wrapDisplayText(text, width).map((line, index) => ({
    key: `${keyPrefix}-header-${index}`,
    selectionId: answerId,
    content: (
      <Text {...styleProps(color, { inverse: selected, dim, yellow: lowConfidence })}>{line}</Text>
    ),
  }));
}

function probabilityRows(
  keyPrefix: string,
  rows: ProbabilityRow[],
  answerId: string,
  width: number,
  color: boolean,
  dim: boolean,
): ViewportRow[] {
  if (width < MIN_BAR + NUM_WIDTH + GUTTERS + 1) {
    const result: ViewportRow[] = [];
    rows.forEach((row, rowIndex) => {
      wrapDisplayText(row.label, width).forEach((line, lineIndex) => {
        result.push({
          key: `${keyPrefix}-probability-${rowIndex}-label-${lineIndex}`,
          selectionId: answerId,
          content: <Text {...styleProps(color, { dim })}>{line}</Text>,
        });
      });
      result.push({
        key: `${keyPrefix}-probability-${rowIndex}-bar`,
        selectionId: answerId,
        content: <Text {...styleProps(color, { dim })}>{bar(row.value, width)}</Text>,
      });
      wrapDisplayText(fmt2(row.value), width).forEach((line, lineIndex) => {
        result.push({
          key: `${keyPrefix}-probability-${rowIndex}-value-${lineIndex}`,
          selectionId: answerId,
          content: <Text {...styleProps(color, { dim })}>{line}</Text>,
        });
      });
    });
    return result;
  }

  const { labelWidth, barWidth } = layout(
    rows.map((row) => row.label),
    width,
  );
  const result: ViewportRow[] = [];
  rows.forEach((row, rowIndex) => {
    const labels = wrapDisplayText(row.label, labelWidth);
    labels.forEach((label, lineIndex) => {
      const padded = padEndDisplay(label, labelWidth);
      result.push({
        key: `${keyPrefix}-probability-${rowIndex}-${lineIndex}`,
        selectionId: answerId,
        content: (
          <Text {...styleProps(color, { dim })}>
            {lineIndex === 0
              ? `${padded}  ${bar(row.value, barWidth)}  ${fmt2(row.value)}`
              : padded}
          </Text>
        ),
      });
    });
  });
  return result;
}

function answerRows(
  id: string,
  answer: Answer,
  selected: boolean,
  stale: boolean,
  width: number,
  color: boolean,
): ViewportRow[] {
  const prefix = selected ? '▸ ' : '  ';
  if (answer.type === 'choice') {
    const low = Number.isFinite(answer.confidence) && answer.confidence < LOW_CONFIDENCE;
    const rows = Object.entries(answer.probabilities)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
    return [
      ...headerRows(
        id,
        `${prefix}CHOICE ${id}  ${answer.choice}  conf ${fmt2(answer.confidence)}${low ? ' !' : ''}`,
        id,
        width,
        color,
        selected,
        stale,
        low,
      ),
      ...probabilityRows(id, rows, id, width, color, stale),
    ];
  }

  if (answer.type === 'score') {
    const levels = Object.keys(answer.legend).sort((a, b) => Number(a) - Number(b));
    const nearestIndex = Math.min(
      Math.max(Math.round(answer.score), 0),
      Math.max(levels.length - 1, 0),
    );
    const nearestKey = levels[nearestIndex];
    const nearestLegend = nearestKey === undefined ? '' : textOf(answer.legend[nearestKey]);
    const low = Number.isFinite(answer.confidence) && answer.confidence < LOW_CONFIDENCE;
    const probabilities = levels.map((level) => ({
      label: `${level} · ${textOf(answer.legend[level])}`,
      value: answer.probabilities[level] ?? 0,
    }));
    const { barWidth } = layout(
      probabilities.map((row) => row.label),
      width,
    );
    return [
      ...headerRows(
        id,
        `${prefix}SCORE ${id}  ${fmt2(answer.score)}  ${nearestLegend}  conf ${fmt2(answer.confidence)}${low ? ' !' : ''}`,
        id,
        width,
        color,
        selected,
        stale,
        low,
      ),
      {
        key: `${id}-scale`,
        selectionId: id,
        content: (
          <Text {...styleProps(color, { dim: stale })}>
            {renderScale(answer.score, levels.length, barWidth)}
          </Text>
        ),
      },
      ...probabilityRows(id, probabilities, id, width, color, stale),
    ];
  }

  const word = Number.isFinite(answer.noul) && answer.noul >= 0.5 ? 'yes' : 'no';
  return [
    ...headerRows(
      id,
      `${prefix}NOUL ${id}  ${fmt2(answer.noul)}  ${word}`,
      id,
      width,
      color,
      selected,
      stale,
    ),
    ...probabilityRows(id, [{ label: 'P(yes)', value: answer.noul }], id, width, color, stale),
  ];
}

export function ResultsView(props: {
  request: Request;
  result: RunResult | undefined;
  stale: boolean;
  running: boolean;
  selectedId: string | undefined;
  width: number;
  color: boolean;
  height?: number;
  active?: boolean;
}) {
  const {
    request,
    result,
    stale,
    running,
    selectedId,
    width,
    color,
    height,
    active = false,
  } = props;
  const rows: ViewportRow[] = [];

  if (!result && !running) {
    rows.push({ key: 'empty', content: <Text>Run the request (r) to see answers here.</Text> });
  } else {
    if (running) rows.push({ key: 'running', content: <Text>Running…</Text> });
    if (stale) {
      rows.push({
        key: 'stale',
        content: <Text {...styleProps(color, { dim: true })}>stale — request changed</Text>,
      });
    }
    let blockIndex = 0;
    if (result) {
      for (const id of questionIds(request)) {
        if (!Object.hasOwn(result.answers, id)) continue;
        const answer = result.answers[id];
        if (!answer) continue;
        if (blockIndex > 0) rows.push({ key: `${id}-gap`, content: <Text> </Text> });
        rows.push(...answerRows(id, answer, id === selectedId, stale, width, color));
        blockIndex += 1;
      }
    }
  }

  return (
    <Viewport
      rows={rows}
      width={width}
      height={height}
      active={active}
      contentKey={`${width}:${running}:${stale}:${JSON.stringify(result)}:${questionIds(request).join(',')}`}
      selectedId={selectedId}
    />
  );
}
