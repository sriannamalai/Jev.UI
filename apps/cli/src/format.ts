import { formatUsd } from '@jev-ui/core';
import type { Answer, RunResult } from '@jev-ui/core';

const FILLED = '█';
const EMPTY = '░';
const NUM_WIDTH = 4; // "0.84", "1.00" — values are always a single digit before the point.
const GUTTER = 6; // 2-space indent + 2-space label/bar gap + 2-space bar/number gap.
const MIN_BAR = 10;

const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

/** Render a probability `p` (clamped to 0..1) as a `width`-wide filled/empty bar. */
export function bar(p: number, width: number): string {
  const clamped = Math.max(0, Math.min(1, p));
  const filled = Math.round(clamped * width);
  return FILLED.repeat(filled) + EMPTY.repeat(width - filled);
}

function colorBar(b: string, color: boolean): string {
  return color ? `${CYAN}${b}${RESET}` : b;
}

function fmtNum(n: number): string {
  return n.toFixed(2);
}

/** Truncate `label` with a trailing "…" to fit `width`, then pad to `width` with spaces. */
function fitLabel(label: string, width: number): string {
  if (label.length <= width) return label.padEnd(width);
  if (width <= 1) return label.slice(0, width);
  return `${label.slice(0, width - 1)}…`.padEnd(width);
}

interface Row {
  label: string;
  value: number;
}

function layout(labels: string[], width: number): { labelWidth: number; barWidth: number } {
  const maxLabelWidth = Math.max(0, width - MIN_BAR - NUM_WIDTH - GUTTER);
  const rawMax = labels.length > 0 ? Math.max(...labels.map((l) => l.length)) : 0;
  const labelWidth = Math.min(rawMax, maxLabelWidth);
  const barWidth = Math.max(MIN_BAR, width - labelWidth - NUM_WIDTH - GUTTER);
  return { labelWidth, barWidth };
}

function renderRows(rows: Row[], width: number, color: boolean): string[] {
  const { labelWidth, barWidth } = layout(
    rows.map((r) => r.label),
    width,
  );
  return rows.map(
    (r) =>
      `  ${fitLabel(r.label, labelWidth)}  ${colorBar(bar(r.value, barWidth), color)}  ${fmtNum(r.value)}`,
  );
}

function formatChoiceBlock(
  key: string,
  answer: Extract<Answer, { type: 'choice' }>,
  width: number,
  color: boolean,
): string[] {
  const header = `choice  ${key}  ${answer.choice}  conf ${fmtNum(answer.confidence)}`;
  const rows: Row[] = Object.entries(answer.probabilities)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  return [header, ...renderRows(rows, width, color)];
}

function formatScoreBlock(
  key: string,
  answer: Extract<Answer, { type: 'score' }>,
  width: number,
  color: boolean,
): string[] {
  const nearest = String(Math.round(answer.score));
  const legendLabel = answer.legend[nearest] ?? '';
  const header = `score  ${key}  ${fmtNum(answer.score)}  ${textOf(legendLabel)}  conf ${fmtNum(answer.confidence)}`;
  const levels = Object.keys(answer.legend).sort((a, b) => Number(a) - Number(b));
  const rows: Row[] = levels.map((level) => ({
    label: `${level} · ${textOf(answer.legend[level])}`,
    value: answer.probabilities[level] ?? 0,
  }));
  return [header, ...renderRows(rows, width, color)];
}

function formatNoulBlock(
  key: string,
  answer: Extract<Answer, { type: 'noul' }>,
  width: number,
  color: boolean,
): string[] {
  const header = `noul  ${key}`;
  const rows: Row[] = [{ label: 'P(yes)', value: answer.noul }];
  return [header, ...renderRows(rows, width, color)];
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function formatFooter(result: RunResult): string {
  const latency = Math.round(result.latencyMs);
  return `${result.model} · ${latency} ms · ${result.usage.inputTokens} tok · ${formatUsd(result.costUsd)}`;
}

export function formatResult(
  result: RunResult,
  opts?: { color?: boolean; width?: number },
): string {
  const width = opts?.width ?? 60;
  const color = opts?.color ?? true;

  const blocks: string[] = [];
  for (const key of Object.keys(result.answers)) {
    const answer = result.answers[key];
    if (!answer) continue;
    if (answer.type === 'choice') {
      blocks.push(formatChoiceBlock(key, answer, width, color).join('\n'));
    } else if (answer.type === 'score') {
      blocks.push(formatScoreBlock(key, answer, width, color).join('\n'));
    } else {
      blocks.push(formatNoulBlock(key, answer, width, color).join('\n'));
    }
  }

  return [...blocks, formatFooter(result)].join('\n\n');
}
