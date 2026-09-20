// The State editor: a plain textarea bound to `request.state`. Keeps the
// user's raw text in local state while typing so an in-flight `{` is never
// reformatted underneath them; resyncs from the store only when the store's
// state changed for a reason other than this component's own last dispatch
// (e.g. a set was loaded).
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { errorTarget, estimateStateBudget, LIMITS, type Text } from '@jev-ui/core/browser';
import { useWorkbench } from '../store.js';

function displayText(state: Text): string {
  return typeof state === 'string' ? state : JSON.stringify(state, null, 2);
}

// Mirrors the core reducer's own equality rule for `state` (strings by
// `===`, everything else by JSON.stringify) so "did the store's state
// actually change" is decided the same way here as it is there. The
// reducer's `setState` is a no-op when the incoming value is equal by this
// rule, in which case it keeps its old (reference-unequal-but-value-equal)
// object — a plain `!==` reference check would then misread that as an
// external change and reformat the user's in-progress text underneath them.
function sameText(a: Text, b: Text): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
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
    if (!sameText(request.state, lastDispatched.current)) {
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

  const wbError = state.wb.error;
  const target = errorTarget(wbError?.path);
  const stateError =
    wbError?.kind === 'validation' && target.field === 'state' ? wbError.message : undefined;

  return (
    <div className="sec">
      <div className="sec-title">
        State <small>text or JSON</small>
      </div>
      <textarea
        className="editor mono"
        aria-label="State"
        aria-invalid={stateError !== undefined ? 'true' : undefined}
        value={text}
        onChange={handleChange}
      />
      {stateError !== undefined && <div role="alert">{stateError}</div>}
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
