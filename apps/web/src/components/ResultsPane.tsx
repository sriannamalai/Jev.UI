// The Results column (spec §8): per-question answer blocks in request
// order, selectable in sync with the other panes, marked stale as soon as
// the request changes after a run.
import { type KeyboardEvent } from 'react';
import { questionIds, type Answer } from '@jev-ui/core/browser';
import { useWorkbench } from '../store.js';
import { ChoiceResult } from './ChoiceResult.js';
import { NoulResult } from './NoulResult.js';
import { ScoreResult } from './ScoreResult.js';

function ResultContent(props: { id: string; answer: Answer }) {
  const { id, answer } = props;
  switch (answer.type) {
    case 'noul':
      return <NoulResult id={id} answer={answer} />;
    case 'choice':
      return <ChoiceResult id={id} answer={answer} />;
    case 'score':
      return <ScoreResult id={id} answer={answer} />;
  }
}

function ResultBlock(props: { id: string; answer: Answer; active: boolean; onSelect: () => void }) {
  const { id, answer, active, onSelect } = props;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  }

  return (
    <div
      className={active ? 'res active' : 'res'}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={`${id} result`}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
    >
      <ResultContent id={id} answer={answer} />
    </div>
  );
}

export function ResultsPane() {
  const { state, dispatch } = useWorkbench();
  const { request, result, stale, running, selectedId } = state.wb;

  function select(id: string): void {
    dispatch({ type: 'wb', action: { type: 'select', id } });
  }

  const blocks: { id: string; answer: Answer }[] = [];
  if (result) {
    for (const id of questionIds(request)) {
      const answer = result.answers[id];
      if (answer) blocks.push({ id, answer });
    }
  }

  return (
    <section className="col col-results">
      <div className="col-head">
        Results
        {stale && <span className="r mono stale-chip">stale — request changed</span>}
      </div>
      <div
        className={stale ? 'pad res-list stale' : 'pad res-list'}
        aria-busy={running || undefined}
      >
        {running && <p className="running">Running…</p>}
        {!result && !running && <p className="empty">Run the request to see answers here.</p>}
        {blocks.map(({ id, answer }) => (
          <ResultBlock
            key={id}
            id={id}
            answer={answer}
            active={id === selectedId}
            onSelect={() => select(id)}
          />
        ))}
      </div>
    </section>
  );
}
