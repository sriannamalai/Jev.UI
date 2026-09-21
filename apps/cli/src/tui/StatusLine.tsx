// The TUI's footer line: resolved model, latency, input tokens,
// and cost — or the key-not-configured hint when running is disabled.
import { Text } from 'ink';
import { formatUsd } from '@jev-ui/core';
import type { RunResult } from '@jev-ui/core';

export function StatusLine(props: { result: RunResult | undefined; keyConfigured: boolean }) {
  const { result, keyConfigured } = props;

  if (!keyConfigured) {
    return <Text>TYPESAFE_API_KEY is not set — editing works, run is disabled</Text>;
  }

  if (!result) {
    return <Text>ready</Text>;
  }

  const latency = Math.round(result.latencyMs);
  return (
    <Text>{`${result.model} · ${latency} ms · ${result.usage.inputTokens} tok · ${formatUsd(result.costUsd)}`}</Text>
  );
}
