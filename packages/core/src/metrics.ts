import type { Request } from './schema.js';

export const USD_PER_MTOK = 0.042;

export function estimateTokens(value: unknown): number {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.ceil(str.length / 4);
}

export function estimateStateBudget(request: Request): number {
  const stateTokens = estimateTokens(request.state);
  const questionTokens = Object.values(request.questions).map((q) => estimateTokens(q));
  const maxQuestionTokens = questionTokens.length > 0 ? Math.max(...questionTokens) : 0;
  return stateTokens + maxQuestionTokens;
}

export function costUsd(inputTokens: number): number {
  return (inputTokens * USD_PER_MTOK) / 1_000_000;
}

export function formatUsd(n: number): string {
  const decimals = n < 0.01 ? 6 : 4;
  return `$${n.toFixed(decimals)}`;
}
