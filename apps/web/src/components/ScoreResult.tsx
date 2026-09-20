// A score answer: a marker on the level scale (score/(levels-1), clamped),
// the legend text of the nearest level, the confidence chip, and one
// probability row per level in level order.
import { Fragment } from 'react';
import type { ScoreAnswer } from '@jev-ui/core/browser';
import { ConfidenceChip, fmt2, Meter, safeFraction } from './Meter.js';

function legendToString(text: unknown): string {
  return typeof text === 'string' ? text : JSON.stringify(text);
}

export function ScoreResult(props: { id: string; answer: ScoreAnswer }) {
  const { id, answer } = props;
  const levels = Object.keys(answer.legend)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const count = levels.length;
  const min = levels[0] ?? 0;
  const max = levels[count - 1] ?? 0;

  const roundedScore = Number.isFinite(answer.score) ? Math.round(answer.score) : min;
  const nearest = Math.min(Math.max(roundedScore, min), max);
  const nearestLegend = answer.legend[String(nearest)];

  const markerLeft = count <= 1 ? 0 : safeFraction(answer.score / (count - 1)) * 100;

  let winnerLevel = levels[0];
  let winnerProb = Number.NEGATIVE_INFINITY;
  for (const level of levels) {
    const p = answer.probabilities[String(level)];
    const value = Number.isFinite(p) ? (p as number) : Number.NEGATIVE_INFINITY;
    if (value > winnerProb) {
      winnerProb = value;
      winnerLevel = level;
    }
  }

  return (
    <>
      <div className="res-head">
        <span className="tag">score</span>
        <span className="qid">{id}</span>
        <ConfidenceChip confidence={answer.confidence} />
      </div>
      <div className="answer">
        {fmt2(answer.score)}{' '}
        <small>{nearestLegend !== undefined ? legendToString(nearestLegend) : ''}</small>
      </div>
      <div
        className="scale"
        role="img"
        aria-label={`Score ${fmt2(answer.score)} on a scale of 0 to ${Math.max(count - 1, 0)}`}
      >
        <div className="axis" />
        {levels.map((level, index) => (
          <div
            className="tick"
            key={level}
            style={{ left: `${count <= 1 ? 0 : (index / (count - 1)) * 100}%` }}
          >
            <span>{level}</span>
          </div>
        ))}
        <div className="mark" style={{ left: `${markerLeft}%` }} />
      </div>
      <div className="dist">
        {levels.map((level) => {
          const key = String(level);
          const p = answer.probabilities[key] ?? NaN;
          const win = level === winnerLevel;
          return (
            <Fragment key={key}>
              <span className={win ? 'lab win' : 'lab'}>
                {level} · {legendToString(answer.legend[key] ?? '')}
              </span>
              <Meter
                value={p}
                ariaLabel={`Level ${level} probability`}
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
