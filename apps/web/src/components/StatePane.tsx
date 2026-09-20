// The State editor: a plain textarea bound to `request.state`. Keeps the
// user's raw text in local state while typing so an in-flight `{` is never
// reformatted underneath them; resyncs from the store only when the store's
// state changed for a reason other than this component's own last dispatch
// (e.g. a set was loaded).
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { estimateStateBudget, LIMITS, type Text } from '@jev-ui/core/browser';
import { useWorkbench } from '../store.js';

function displayText(state: Text): string {
  return typeof state === 'string' ? state : JSON.stringify(state, null, 2);
}

type Indicator = 'plain text' | 'JSON ✓' | 'JSON ✗ (sent as text)';

function classify(text: string): { indicator: Indicator; value: Text } {
  const trimmed = text.trim();
  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (!looksJson) return { indicator: 'plain text', value: text };

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object') {
      return { indicator: 'JSON ✓', value: parsed as Text };
    }
    return { indicator: 'JSON ✗ (sent as text)', value: text };
  } catch {
    return { indicator: 'JSON ✗ (sent as text)', value: text };
  }
}

export function StatePane() {
  const { state, dispatch } = useWorkbench();
  const request = state.wb.request;
  const [text, setText] = useState(() => displayText(request.state));
  const lastDispatched = useRef<Text>(request.state);

  useEffect(() => {
    if (request.state !== lastDispatched.current) {
      setText(displayText(request.state));
      lastDispatched.current = request.state;
    }
  }, [request.state]);

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    const value = event.target.value;
    setText(value);
    const { value: next } = classify(value);
    lastDispatched.current = next;
    dispatch({ type: 'wb', action: { type: 'setState', state: next } });
  }

  const { indicator } = classify(text);
  const tokens = estimateStateBudget(request);
  const budget = LIMITS.stateBudgetTokens;
  const over = tokens > budget;
  const pct = Math.max(0, Math.min(100, (tokens / budget) * 100));

  return (
    <div className="sec">
      <div className="sec-title">
        State <small>text or JSON</small>
      </div>
      <textarea className="editor mono" aria-label="State" value={text} onChange={handleChange} />
      <div
        className={over ? 'meter over' : 'meter'}
        role="meter"
        aria-valuenow={tokens}
        aria-valuemin={0}
        aria-valuemax={budget}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="meta">
        <span>{indicator}</span>
        <span className="mono">
          ≈ {tokens.toLocaleString()} / {budget.toLocaleString()} tokens
        </span>
      </div>
    </div>
  );
}
