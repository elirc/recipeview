/** Presentation helpers shared across the UI. */

/** "2026-07-14" -> "Jul 14, 2026". Date-only, no timezone drift. */
export function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${mo} ${d}, ${y}`;
}

/** Relative-ish label for feeds: "today", "3d ago", else a short date. */
export function fmtWhen(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  const then = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today - then) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days > 1 && days < 7) return `${days}d ago`;
  if (days < 0) return fmtDate(iso);
  const wk = Math.floor(days / 7);
  if (wk < 5) return `${wk}w ago`;
  return fmtDate(iso);
}

/** Round to one decimal, dropping a trailing ".0". */
export function fmt1(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '–';
  return String(Number(n.toFixed(1)));
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Color token for a 1..5 score. */
export function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'var(--ink-3)';
  if (score >= 4) return 'var(--good)';
  if (score >= 3) return 'var(--mid)';
  return 'var(--bad)';
}

export function makeAgainLabel(v: string | null): string {
  return v === 'yes' ? 'Would remake' : v === 'maybe' ? 'Maybe again' : v === 'no' ? "Wouldn't remake" : '';
}

export function pluralize(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}
