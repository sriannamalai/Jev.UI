// The TUI's footer line: resolved model, latency, input tokens,
// and cost — or the key-not-configured hint when running is disabled.
import { Text } from 'ink';
import { formatUsd } from '@jev-ui/core';
import type { RunResult } from '@jev-ui/core';
import { truncate } from './bars.js';

export function StatusLine(props: {
  result: RunResult | undefined;
  keyConfigured: boolean;
  message?: string;
  isError?: boolean;
  width?: number;
  color?: boolean;
}) {
  const { result, keyConfigured, message, isError = false, width = 100, color = true } = props;

  if (message) {
    return <Text color={isError && color ? 'red' : undefined}>{truncate(message, width)}</Text>;
  }

  if (!keyConfigured) {
    return (
      <Text>{truncate('TYPESAFE_API_KEY is not set — editing works, run is disabled', width)}</Text>
    );
  }

  if (!result) {
    return <Text>{truncate('ready', width)}</Text>;
  }

  const latency = Math.round(result.latencyMs);
  return (
    <Text>
      {truncate(
        `${result.model} · ${latency} ms · ${result.usage.inputTokens} tok · ${formatUsd(result.costUsd)}`,
        width,
      )}
    </Text>
  );
}
