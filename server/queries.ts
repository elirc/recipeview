import { db, tagsFor } from './db.ts';
import type { CookLog, Dish, DishDetail, Recipe, RecipeDetail, RecipeStats, SearchHit } from '../shared/types.ts';
import { cookScore } from '../shared/types.ts';

// Ratings live on cook logs, so every recipe-level number is an aggregate over
// them. `make_again` is text on the wire and weighted here: yes=1, maybe=.5, no=0.
const STATS_SQL = `
  SELECT
    COUNT(*)                                     AS cook_count,
    AVG(rating_taste)                            AS avg_taste,
    AVG(rating_texture)                          AS avg_texture,
    AVG(rating_effort)                           AS avg_effort,
    AVG(CASE make_again WHEN 'yes' THEN 1.0 WHEN 'maybe' THEN 0.5 WHEN 'no' THEN 0.0 END) AS make_again_rate,
    MAX(cooked_on)                               AS last_cooked,
    MIN(cooked_on)                               AS first_cooked
  FROM cook_logs WHERE recipe_id = ?
`;

export function statsFor(recipeId: number): RecipeStats {
  const r = db.prepare(STATS_SQL).get(recipeId) as any;
  return {
    cook_count: r.cook_count ?? 0,
    avg_taste: r.avg_taste,
    avg_texture: r.avg_texture,
    avg_effort: r.avg_effort,
    make_again_rate: r.make_again_rate,
    last_cooked: r.last_cooked,
    first_cooked: r.first_cooked,
  };
}

function photosFor(logId: number) {
  return db.prepare('SELECT * FROM photos WHERE cook_log_id = ? ORDER BY position, id').all(logId) as any[];
}

export function cookLogsFor(recipeId: number): CookLog[] {
  // Reverse chronological, with a tiebreak on id so multiple cooks logged on
  // the same date still read newest-first.
  const rows = db
    .prepare('SELECT * FROM cook_logs WHERE recipe_id = ? ORDER BY cooked_on DESC, id DESC')
    .all(recipeId) as any[];
  return rows.map((r) => ({ ...r, photos: photosFor(r.id) })) as CookLog[];
}

export function getRecipe(id: number): Recipe | null {
  const r = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id) as any;
  if (!r) return null;
  return { ...r, tags: tagsFor('recipe', id), stats: statsFor(id) };
}

export function getRecipeDetail(id: number): RecipeDetail | null {
  const base = getRecipe(id);
  if (!base) return null;
  const dish = db.prepare('SELECT name FROM dishes WHERE id = ?').get(base.dish_id) as any;
  const logs = cookLogsFor(id);

  // "Best" = highest taste/texture mean; ties break toward the most recent,
  // since the latest good result is the one worth repeating.
  let best: CookLog | null = null;
  let bestScore = -Infinity;
  for (const l of logs) {
    const s = cookScore(l);
    if (s == null) continue;
    if (s > bestScore) {
      bestScore = s;
      best = l;
    }
  }

  return {
    ...base,
    dish_name: dish?.name ?? '',
    ingredients: db
      .prepare('SELECT * FROM ingredients WHERE recipe_id = ? ORDER BY position, id')
      .all(id) as any[],
    steps: db.prepare('SELECT * FROM steps WHERE recipe_id = ? ORDER BY position, id').all(id) as any[],
    cook_logs: logs,
    best_log: best,
  };
}

export function recipesForDish(dishId: number): Recipe[] {
  const rows = db.prepare('SELECT id FROM recipes WHERE dish_id = ? ORDER BY id').all(dishId) as any[];
  return rows.map((r) => getRecipe(r.id)!).filter(Boolean);
}

function dishRollup(d: any): Dish {
  const agg = db
    .prepare(
      `SELECT
         COUNT(DISTINCT r.id) AS recipe_count,
         COUNT(cl.id)         AS cook_count,
         MAX(cl.cooked_on)    AS last_cooked,
         SUM(CASE WHEN r.verdict = 'keeper' THEN 1 ELSE 0 END) AS keepers
       FROM recipes r
       LEFT JOIN cook_logs cl ON cl.recipe_id = r.id
       WHERE r.dish_id = ?`,
    )
    .get(d.id) as any;

  // Best score across the dish's recipes: the headline "how good does this
  // dish get, at its best" number for the home list.
  const best = db
    .prepare(
      `SELECT MAX(score) AS best FROM (
         SELECT (COALESCE(AVG(cl.rating_taste), AVG(cl.rating_texture)) + COALESCE(AVG(cl.rating_texture), AVG(cl.rating_taste))) / 2.0 AS score
         FROM recipes r JOIN cook_logs cl ON cl.recipe_id = r.id
         WHERE r.dish_id = ? GROUP BY r.id
       )`,
    )
    .get(d.id) as any;

  return {
    ...d,
    tags: tagsFor('dish', d.id),
    recipe_count: agg?.recipe_count ?? 0,
    cook_count: agg?.cook_count ?? 0,
    last_cooked: agg?.last_cooked ?? null,
    best_score: best?.best ?? null,
    has_keeper: (agg?.keepers ?? 0) > 0,
  };
}

export type DishSort = 'recent' | 'name' | 'cooks';

export function listDishes(opts: { tag?: string; sort?: DishSort } = {}): Dish[] {
  let sql = 'SELECT d.* FROM dishes d';
  const params: any[] = [];
  if (opts.tag) {
    sql += ` JOIN dish_tags dt ON dt.dish_id = d.id JOIN tags t ON t.id = dt.tag_id AND t.name = ? COLLATE NOCASE`;
    params.push(opts.tag);
  }
  sql += ' GROUP BY d.id';
  const rows = db.prepare(sql).all(...params) as any[];
  const dishes = rows.map(dishRollup);

  switch (opts.sort ?? 'recent') {
    case 'name':
      dishes.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'cooks':
      dishes.sort((a, b) => b.cook_count - a.cook_count || a.name.localeCompare(b.name));
      break;
    default:
      // Most recently cooked first; never-cooked dishes fall to the bottom
      // rather than the top, ordered by when they were added.
      dishes.sort((a, b) => {
        if (a.last_cooked && b.last_cooked) return b.last_cooked.localeCompare(a.last_cooked);
        if (a.last_cooked) return -1;
        if (b.last_cooked) return 1;
        return b.created_at.localeCompare(a.created_at);
      });
  }
  return dishes;
}

export function getDishDetail(id: number): DishDetail | null {
  const d = db.prepare('SELECT * FROM dishes WHERE id = ?').get(id) as any;
  if (!d) return null;
  return { ...dishRollup(d), recipes: recipesForDish(id) };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Turn a user's raw typing into an FTS5 query.
 *
 * Users type `garlic`, not `garlic*`. They also type apostrophes and hyphens,
 * which are FTS5 syntax and will throw a parse error if passed through. So:
 * quote every term (neutralising syntax) and append * to the last one for
 * as-you-type prefix matching.
 */
export function toFtsQuery(raw: string): string | null {
  const terms = raw
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '').trim())
    .filter(Boolean);
  if (!terms.length) return null;
  return terms.map((t, i) => (i === terms.length - 1 ? `"${t}"*` : `"${t}"`)).join(' ');
}

export function search(raw: string, limit = 40): SearchHit[] {
  const q = toFtsQuery(raw);
  if (!q) return [];

  let rows: any[];
  try {
    rows = db
      .prepare(
        `SELECT kind, ref_id, dish_id, recipe_id, title,
                snippet(search_index, 5, '<mark>', '</mark>', '…', 12) AS body_snip,
                snippet(search_index, 4, '<mark>', '</mark>', '…', 12) AS title_snip,
                bm25(search_index, 0, 0, 0, 0, 10.0, 1.0) AS rank
         FROM search_index
         WHERE search_index MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(q, limit) as any[];
  } catch {
    // Malformed FTS expression despite quoting — treat as no results rather
    // than 500ing on someone's stray punctuation.
    return [];
  }

  return rows.map((r) => {
    const context =
      r.kind === 'dish'
        ? 'Dish'
        : r.kind === 'recipe'
          ? dishName(r.dish_id)
          : `${dishName(r.dish_id)} / ${recipeTitle(r.recipe_id)}`;
    return {
      kind: r.kind,
      ref_id: r.ref_id,
      dish_id: r.dish_id,
      recipe_id: r.recipe_id,
      title: r.title,
      snippet: r.body_snip || r.title_snip || '',
      context,
      rank: r.rank,
    };
  });
}

function dishName(id: number | null): string {
  if (!id) return '';
  return ((db.prepare('SELECT name FROM dishes WHERE id = ?').get(id) as any)?.name as string) ?? '';
}
function recipeTitle(id: number | null): string {
  if (!id) return '';
  return ((db.prepare('SELECT title FROM recipes WHERE id = ?').get(id) as any)?.title as string) ?? '';
}

export function allTags() {
  return db
    .prepare(
      `SELECT t.id, t.name,
              (SELECT COUNT(*) FROM dish_tags WHERE tag_id = t.id) +
              (SELECT COUNT(*) FROM recipe_tags WHERE tag_id = t.id) AS uses
       FROM tags t ORDER BY uses DESC, t.name`,
    )
    .all() as { id: number; name: string; uses: number }[];
}
