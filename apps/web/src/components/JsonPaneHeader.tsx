// Pure presentational header for the JSON pane: title plus a status readout
// that mirrors the pane's current validity/sync state (spec §8.1).
export interface JsonPaneError {
  message: string;
  line?: number;
}

export function JsonPaneHeader(props: { error: JsonPaneError | undefined; synced: boolean }) {
  const { error, synced } = props;

  if (error === undefined) {
    return (
      <div className="col-head">
        Request JSON
        <span className="r valid">{synced ? '● valid · in sync' : '● valid'}</span>
      </div>
    );
  }

  const text =
    error.line !== undefined ? `✕ line ${error.line}: ${error.message}` : `✕ ${error.message}`;

  return (
    <div className="col-head">
      Request JSON
      <span className="r err" role="status">
        {text}
      </span>
    </div>
  );
}
