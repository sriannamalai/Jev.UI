// Reads `state.wb.error` and renders a dismissible banner naming what went
// wrong (spec §9). Field-level `validation` errors are surfaced next to the
// offending field elsewhere (Task 11); this banner just gives every error
// kind, including `validation`, a one-line summary and a way to retry or
// dismiss.
import type { JevErrorKind } from '@jev-ui/core/browser';
import { useWorkbench } from '../store.js';

const RETRYABLE: ReadonlySet<JevErrorKind> = new Set([
  'rateLimit',
  'overloaded',
  'network',
  'timeout',
]);

const LEAD: Record<JevErrorKind, string> = {
  auth: 'API key rejected',
  noKey: 'No API key configured',
  rateLimit: 'Rate limited',
  overloaded: 'TypeSafe is overloaded',
  network: 'Cannot reach the server',
  timeout: 'Request timed out',
  validation: 'Request rejected',
  unexpected: 'Unexpected error',
};

export function Banner() {
  const { state, dispatch, run } = useWorkbench();
  const error = state.wb.error;
  if (error === undefined) return null;

  const { kind, message, path } = error;
  const lead =
    kind === 'validation' && path !== undefined ? `${LEAD[kind]} at ${path}` : LEAD[kind];

  return (
    <div className="banner" role="alert">
      <span>
        <b>{lead}</b> — {message}
      </span>
      <span className="r">
        {RETRYABLE.has(kind) && (
          <button type="button" onClick={() => void run()}>
            Retry
          </button>
        )}
        <button
          type="button"
          onClick={() => dispatch({ type: 'wb', action: { type: 'dismissError' } })}
        >
          Dismiss
        </button>
      </span>
    </div>
  );
}
