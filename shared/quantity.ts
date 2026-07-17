/**
 * Quantity parsing and formatting for ingredient scaling.
 *
 * Cooks write "1 1/2 cups", not "1.5 cups". Scaling has to survive the round
 * trip: parse to a float, multiply, and render back to something a human reads
 * at a glance in a kitchen. 0.375 cup is a correct answer and a useless one.
 */

const VULGAR: Record<string, number> = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅐': 1 / 7, '⅛': 0.125,
  '⅜': 0.375, '⅝': 0.625, '⅞': 0.875, '⅑': 1 / 9, '⅒': 0.1,
};

/** Denominators a cook actually has tools for. */
const KITCHEN_DENOMS = [2, 3, 4, 6, 8];

const FRACTION_GLYPH: Record<string, string> = {
  '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾',
  '1/6': '⅙', '5/6': '⅚', '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞',
};

/**
 * Parse a human quantity string to a number.
 * Handles "2", "1.5", "1 1/2", "3/4", "1½", "½", "2-3" (takes the low end).
 * Returns null for "a pinch", "to taste", "" — which are legitimate and stay
 * unscaled rather than being coerced to zero.
 */
export function parseQty(raw: string): number | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;

  // Ranges ("2-3 cloves"): anchor on the low end so scaling stays predictable.
  const range = s.match(/^([\d\s./]+?)\s*(?:-|–|to)\s*([\d\s./]+)$/);
  if (range) s = range[1].trim();

  // Expand vulgar fractions, inserting a space if glued to a number ("1½" -> "1 1/2").
  for (const [glyph, val] of Object.entries(VULGAR)) {
    if (!s.includes(glyph)) continue;
    s = s.replace(new RegExp(`(\\d)?${glyph}`, 'g'), (_m, d: string | undefined) => (d ? `${d} ` : '') + fracToStr(val));
  }

  let total = 0;
  let matched = false;
  for (const part of s.split(/\s+/)) {
    if (!part) continue;
    const frac = part.match(/^(\d+)\/(\d+)$/);
    if (frac) {
      const d = Number(frac[2]);
      if (d === 0) return null;
      total += Number(frac[1]) / d;
      matched = true;
      continue;
    }
    if (/^\d*\.?\d+$/.test(part)) {
      total += Number(part);
      matched = true;
      continue;
    }
    // Trailing words ("cups") end the numeric run.
    break;
  }
  return matched ? total : null;
}

function fracToStr(v: number): string {
  for (const d of [2, 3, 4, 5, 6, 8]) {
    const n = Math.round(v * d);
    if (Math.abs(n / d - v) < 1e-9) return `${n}/${d}`;
  }
  return String(v);
}

/**
 * Render a number back to kitchen-legible text.
 *
 * Snaps to the nearest common fraction when it's close enough to be
 * indistinguishable with real measuring cups, otherwise falls back to a
 * trimmed decimal. Big numbers (grams) round to whole units.
 */
export function formatQty(v: number | null, opts: { unicode?: boolean } = {}): string {
  if (v == null || Number.isNaN(v)) return '';
  if (v === 0) return '0';
  const unicode = opts.unicode ?? true;

  // Weights and large counts: fractions of a gram help nobody.
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) return trimDecimal(v, 1);

  const whole = Math.floor(v);
  const rem = v - whole;
  if (rem < 1e-6) return String(whole);

  let best: { n: number; d: number; err: number } | null = null;
  for (const d of KITCHEN_DENOMS) {
    const n = Math.round(rem * d);
    if (n === 0 || n >= d) continue;
    const err = Math.abs(n / d - rem);
    if (!best || err < best.err - 1e-9) best = { n, d, err };
  }

  // Tolerance scales with the value: 0.02 off a tablespoon is nothing, 0.02
  // off 1/8 tsp is 16%. Reject the fraction if it isn't honestly close.
  const tolerance = Math.max(0.015, v * 0.02);
  if (best && best.err <= tolerance) {
    const g = simplify(best.n, best.d);
    const key = `${g.n}/${g.d}`;
    const frac = unicode && FRACTION_GLYPH[key] ? FRACTION_GLYPH[key] : key;
    return whole > 0 ? `${whole}${unicode && FRACTION_GLYPH[key] ? '' : ' '}${frac}` : frac;
  }
  return trimDecimal(v, 2);
}

function simplify(n: number, d: number) {
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
function trimDecimal(v: number, places: number): string {
  return String(Number(v.toFixed(places)));
}

/** Scale + format in one step, preserving "to taste" (null) quantities. */
export function scaleQty(qty: number | null, factor: number): string {
  if (qty == null) return '';
  return formatQty(qty * factor);
}

/**
 * Common scaling presets. Halving and doubling are the overwhelmingly common
 * cases; the rest is a free-form multiplier in the UI.
 */
export const SCALE_PRESETS = [0.5, 1, 1.5, 2, 3] as const;
