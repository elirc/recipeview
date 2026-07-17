import type { ReactNode } from 'react';
import { VERDICT_LABEL, type Verdict } from '@shared/types';
import { fmt1, scoreColor } from '../lib/format';

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <span className={`verdict ${verdict}`}>{VERDICT_LABEL[verdict]}</span>;
}

/** Static rating display as filled/empty pips (1..5). */
export function Pips({ value, color }: { value: number | null; color?: string }) {
  if (value == null) return <span className="muted mono">—</span>;
  const rounded = Math.round(value);
  return (
    <span className="pips" style={{ ['--rating-color' as string]: color ?? scoreColor(value) }} aria-label={`${fmt1(value)} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`pip ${n <= rounded ? 'on' : ''}`} />
      ))}
    </span>
  );
}

/** Interactive 1..5 picker. Click a pip to set, click the active max to clear. */
export function PipInput({
  value,
  onChange,
  color,
  labels,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  color?: string;
  labels?: [string, string]; // [low, high] endpoint hints
}) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <span className="pips" style={{ ['--rating-color' as string]: color ?? 'var(--accent)', gap: 4 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`pip-btn ${value != null && n <= value ? 'on' : ''}`}
            aria-label={`${n} of 5`}
            aria-pressed={value === n}
            onClick={() => onChange(value === n ? null : n)}
          />
        ))}
      </span>
      {labels && value == null && (
        <span className="hint" style={{ fontSize: 11 }}>
          {labels[0]} → {labels[1]}
        </span>
      )}
      {value != null && (
        <button type="button" className="linkish" onClick={() => onChange(null)} title="Clear">
          {value}/5 ✕
        </button>
      )}
    </div>
  );
}

/** A labeled 0..5 score with a mini bar. Used in recipe comparison.
 *  Pass `color` for axes where high isn't "good" (effort) — the default
 *  good/bad gradient only fits taste and texture. */
export function ScoreBar({
  label,
  value,
  max = 5,
  color,
}: {
  label: string;
  value: number | null;
  max?: number;
  color?: string;
}) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="scorebar-row">
      <span className="scorebar-label">{label}</span>
      <div
        className="scorebar"
        style={{ ['--pct' as string]: `${pct}%`, ['--rating-color' as string]: color ?? scoreColor(value) }}
      />
      <span className="scorebar-num mono">{fmt1(value)}</span>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <div style={{ fontWeight: 650, color: 'var(--ink-2)', marginBottom: 4 }}>{title}</div>
      {children && <div style={{ fontSize: 14 }}>{children}</div>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="center-load">
      <div className="spin" />
    </div>
  );
}
