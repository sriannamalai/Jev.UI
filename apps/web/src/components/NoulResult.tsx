// A noul answer: a P(yes) bar with a 0.5 midline (the midline is a CSS
// pseudo-element on `.noul`, see theme.css) plus the yes/no word.
import type { NoulAnswer } from '@jev-ui/core/browser';
import { fmt2, Meter } from './Meter.js';

export function NoulResult(props: { id: string; answer: NoulAnswer }) {
  const { id, answer } = props;
  const word = Number.isFinite(answer.noul) && answer.noul >= 0.5 ? 'yes' : 'no';

  return (
    <>
      <div className="res-head">
        <span className="tag">noul</span>
        <span className="qid">{id}</span>
        <span className="conf">P(yes)</span>
      </div>
      <div className="answer">
        {fmt2(answer.noul)} <small>{word}</small>
      </div>
      <Meter value={answer.noul} ariaLabel={`P(yes) for ${id}`} trackClassName="noul" />
      <div className="ends">
        <span>no · 0</span>
        <span>0.5</span>
        <span>1 · yes</span>
      </div>
    </>
  );
}
