// A choice answer: the winning option plus every option as a probability
// bar, sorted probability descending (ties keep the original key order —
// `Array#sort` is a stable sort, so a plain comparator is enough).
import { Fragment } from 'react';
import type { ChoiceAnswer } from '@jev-ui/core/browser';
import { ConfidenceChip, fmt2, Meter } from './Meter.js';

function rank(p: number): number {
  return Number.isFinite(p) ? p : Number.NEGATIVE_INFINITY;
}

export function ChoiceResult(props: { id: string; answer: ChoiceAnswer }) {
  const { id, answer } = props;
  const keys = Object.keys(answer.probabilities);
  const sorted = keys
    .slice()
    .sort((a, b) => rank(answer.probabilities[b] ?? NaN) - rank(answer.probabilities[a] ?? NaN));

  return (
    <>
      <div className="res-head">
        <span className="tag">choice</span>
        <span className="qid">{id}</span>
        <ConfidenceChip confidence={answer.confidence} />
      </div>
      <div className="answer">{answer.choice}</div>
      <div className="dist">
        {sorted.map((key) => {
          const p = answer.probabilities[key] ?? NaN;
          const win = key === answer.choice;
          return (
            <Fragment key={key}>
              <span className={win ? 'lab win' : 'lab'}>{key}</span>
              <Meter
                value={p}
                ariaLabel={`${key} probability`}
                fillClassName={win ? 'win' : undefined}
              />
              <span className="p">{fmt2(p)}</span>
            </Fragment>
          );
        })}
      </div>
    </>
  );
}
