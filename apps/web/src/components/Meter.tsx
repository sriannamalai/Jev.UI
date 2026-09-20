// Small building blocks shared by the three result renderers (NoulResult,
// ChoiceResult, ScoreResult): a probability/score meter bar and a confidence
// chip. Numbers are always rendered with a fixed 2dp helper and a non-finite
// value (e.g. a NaN probability) never crashes a bar — it renders 0-width.
export const LOW_CONFIDENCE = 0.8;

export function fmt2(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '–';
}

export function safeFraction(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function Meter(props: {
  value: number;
  max?: number;
  ariaLabel: string;
  trackClassName?: string;
  fillClassName?: string;
}) {
  const { value, max = 1, ariaLabel, trackClassName = 'track', fillClassName } = props;
  const finite = Number.isFinite(value);
  const fraction = finite && max > 0 ? safeFraction(value / max) : 0;
  return (
    <div
      className={trackClassName}
      role="meter"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={finite ? value : 0}
    >
      <i className={fillClassName} style={{ width: `${fraction * 100}%` }} />
    </div>
  );
}

export function ConfidenceChip(props: { confidence: number }) {
  const { confidence } = props;
  const low = Number.isFinite(confidence) && confidence < LOW_CONFIDENCE;
  return (
    <span className={low ? 'conf mid' : 'conf'}>
      conf {fmt2(confidence)}
      <span className="ring">
        <i style={{ width: `${safeFraction(confidence) * 100}%` }} />
      </span>
    </span>
  );
}
