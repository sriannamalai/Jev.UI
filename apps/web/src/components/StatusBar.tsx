// Footer status line: resolved model/latency/tokens/cost after a run, or an
// estimate of the whole request's tokens and cost before one. The pre-run
// figure is labelled so it is not mistaken for the State pane's budget meter,
// which measures only the state plus the largest question.
import { costUsd, estimateTokens, formatUsd } from '@jev-ui/core/browser';
import { useWorkbench } from '../store.js';

export function StatusBar() {
  const { state } = useWorkbench();
  const { result, request } = state.wb;

  if (result) {
    return (
      <footer className="status" role="contentinfo">
        <span>
          model <b>{result.model}</b>
        </span>
        <span>
          latency <b>{Math.round(result.latencyMs)} ms</b>
        </span>
        <span>
          input <b>{result.usage.inputTokens} tok</b>
        </span>
        <span>
          cost <b>{formatUsd(result.costUsd)}</b>
        </span>
      </footer>
    );
  }

  const tokens = estimateTokens(request);
  return (
    <footer className="status" role="contentinfo">
      <span>
        <b>≈ {tokens} tok</b> (request text only)
      </span>
      <span>
        <b>≈ {formatUsd(costUsd(tokens))}</b>
      </span>
    </footer>
  );
}
