export type Verdict = 'keeper' | 'needs-work' | 'abandoned' | 'untested';
export const VERDICTS: Verdict[] = ['keeper', 'needs-work', 'abandoned', 'untested'];

export const VERDICT_LABEL: Record<Verdict, string> = {
  keeper: 'Keeper',
  'needs-work': 'Needs work',
  abandoned: 'Abandoned',
  untested: 'Untested',
};

export type MakeAgain = 'yes' | 'maybe' | 'no';
export const MAKE_AGAIN: MakeAgain[] = ['yes', 'maybe', 'no'];

export interface Tag {
  id: number;
  name: string;
}

export interface Ingredient {
  id: number;
  recipe_id: number;
  position: number;
  qty: number | null;
  unit: string;
  item: string;
  note: string;
  section: string;
}
export type IngredientInput = Omit<Ingredient, 'id' | 'recipe_id'>;

export interface Step {
  id: number;
  recipe_id: number;
  position: number;
  text: string;
}

export interface Photo {
  id: number;
  cook_log_id: number;
  filename: string;
  caption: string;
  position: number;
  created_at: string;
}

export interface CookLog {
  id: number;
  recipe_id: number;
  cooked_on: string;
  changes: string;
  taste_notes: string;
  process_notes: string;
  next_time: string;
  rating_taste: number | null;
  rating_texture: number | null;
  rating_effort: number | null;
  make_again: MakeAgain | null;
  created_at: string;
  updated_at: string;
  photos: Photo[];
}

export type CookLogInput = Partial<Omit<CookLog, 'id' | 'recipe_id' | 'created_at' | 'updated_at' | 'photos'>>;

/** Rollup of a recipe's cook logs. Averages are null until there's data. */
export interface RecipeStats {
  cook_count: number;
  avg_taste: number | null;
  avg_texture: number | null;
  avg_effort: number | null;
  /** 0..1. yes = 1, maybe = 0.5, no = 0. */
  make_again_rate: number | null;
  last_cooked: string | null;
  first_cooked: string | null;
}

export interface Recipe {
  id: number;
  dish_id: number;
  title: string;
  source_name: string;
  source_url: string;
  verdict: Verdict;
  yield_qty: number;
  yield_unit: string;
  notes: string;
  created_at: string;
  updated_at: string;
  tags: Tag[];
  stats: RecipeStats;
}

export interface RecipeDetail extends Recipe {
  dish_name: string;
  ingredients: Ingredient[];
  steps: Step[];
  cook_logs: CookLog[];
  /** The highest-scoring cook log, if any log has been rated. Drives the
   *  "what worked" callout — the whole 4-stars-when-you-cold-ferment thesis. */
  best_log: CookLog | null;
}

export interface Dish {
  id: number;
  name: string;
  notes: string;
  created_at: string;
  updated_at: string;
  tags: Tag[];
  recipe_count: number;
  cook_count: number;
  last_cooked: string | null;
  /** Best average taste/texture across the dish's recipes. */
  best_score: number | null;
  has_keeper: boolean;
}

export interface DishDetail extends Dish {
  recipes: Recipe[];
}

export type SearchKind = 'dish' | 'recipe' | 'cook_log';

export interface SearchHit {
  kind: SearchKind;
  ref_id: number;
  dish_id: number | null;
  recipe_id: number | null;
  title: string;
  snippet: string;
  /** Human-readable trail, e.g. "Pizza / Neapolitan 65%". */
  context: string;
  rank: number;
}

/** yes=1, maybe=0.5, no=0 — used on both sides of the wire. */
export const MAKE_AGAIN_VALUE: Record<MakeAgain, number> = { yes: 1, maybe: 0.5, no: 0 };

/**
 * Overall score for a cook: the mean of taste and texture.
 *
 * Effort is deliberately excluded. A fiddly recipe that tastes incredible
 * shouldn't score the same as a lazy one that tastes fine — those are two
 * different facts and the UI shows them as two different numbers.
 */
export function cookScore(log: Pick<CookLog, 'rating_taste' | 'rating_texture'>): number | null {
  const vals = [log.rating_taste, log.rating_texture].filter((v): v is number => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
