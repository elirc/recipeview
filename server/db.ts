import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.RECIPE_LAB_DATA ?? path.resolve(__dirname, '..', 'data');
export const PHOTO_DIR = path.join(DATA_DIR, 'photos');

fs.mkdirSync(PHOTO_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, 'recipe-lab.db');
export const db = new DatabaseSync(dbPath);

db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

/** Run fn inside a transaction, rolling back on throw. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Search indexing
//
// FTS rows are rebuilt from source on every write. Cheap at journal scale, and
// it keeps the index honest without four tables' worth of triggers trying to
// stay in sync with each other.
// ---------------------------------------------------------------------------

function clearIndex(kind: string, refId: number) {
  db.prepare('DELETE FROM search_index WHERE kind = ? AND ref_id = ?').run(kind, refId);
}

export function reindexDish(dishId: number) {
  clearIndex('dish', dishId);
  const dish = db.prepare('SELECT * FROM dishes WHERE id = ?').get(dishId) as any;
  if (!dish) return;
  const tags = db
    .prepare('SELECT t.name FROM tags t JOIN dish_tags dt ON dt.tag_id = t.id WHERE dt.dish_id = ?')
    .all(dishId)
    .map((r: any) => r.name);
  db.prepare(
    'INSERT INTO search_index (kind, ref_id, dish_id, recipe_id, title, body) VALUES (?, ?, ?, NULL, ?, ?)',
  ).run('dish', dishId, dishId, dish.name, [dish.notes, ...tags].filter(Boolean).join('\n'));
}

export function reindexRecipe(recipeId: number) {
  clearIndex('recipe', recipeId);
  const r = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId) as any;
  if (!r) return;
  const ings = db
    .prepare('SELECT qty, unit, item, note, section FROM ingredients WHERE recipe_id = ? ORDER BY position')
    .all(recipeId) as any[];
  const steps = db.prepare('SELECT text FROM steps WHERE recipe_id = ? ORDER BY position').all(recipeId) as any[];
  const tags = db
    .prepare('SELECT t.name FROM tags t JOIN recipe_tags rt ON rt.tag_id = t.id WHERE rt.recipe_id = ?')
    .all(recipeId)
    .map((x: any) => x.name);

  const body = [
    r.notes,
    r.source_name,
    r.source_url,
    ...tags,
    ...ings.map((i) => [i.unit, i.item, i.note, i.section].filter(Boolean).join(' ')),
    ...steps.map((s) => s.text),
  ]
    .filter(Boolean)
    .join('\n');

  db.prepare(
    'INSERT INTO search_index (kind, ref_id, dish_id, recipe_id, title, body) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('recipe', recipeId, r.dish_id, recipeId, r.title, body);
}

export function reindexCookLog(logId: number) {
  clearIndex('cook_log', logId);
  const l = db
    .prepare(
      `SELECT cl.*, r.dish_id, r.title AS recipe_title
       FROM cook_logs cl JOIN recipes r ON r.id = cl.recipe_id WHERE cl.id = ?`,
    )
    .get(logId) as any;
  if (!l) return;
  const captions = db
    .prepare('SELECT caption FROM photos WHERE cook_log_id = ?')
    .all(logId)
    .map((p: any) => p.caption);

  const body = [l.changes, l.taste_notes, l.process_notes, l.next_time, ...captions].filter(Boolean).join('\n');
  db.prepare(
    'INSERT INTO search_index (kind, ref_id, dish_id, recipe_id, title, body) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('cook_log', logId, l.dish_id, l.recipe_id, `${l.recipe_title} — ${l.cooked_on}`, body);
}

/** Reindex a recipe and every cook log under it (titles embed the recipe name). */
export function reindexRecipeTree(recipeId: number) {
  reindexRecipe(recipeId);
  for (const row of db.prepare('SELECT id FROM cook_logs WHERE recipe_id = ?').all(recipeId) as any[]) {
    reindexCookLog(row.id);
  }
}

export function rebuildAllIndexes() {
  db.exec('DELETE FROM search_index');
  for (const d of db.prepare('SELECT id FROM dishes').all() as any[]) reindexDish(d.id);
  for (const r of db.prepare('SELECT id FROM recipes').all() as any[]) reindexRecipe(r.id);
  for (const l of db.prepare('SELECT id FROM cook_logs').all() as any[]) reindexCookLog(l.id);
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export function upsertTag(name: string): number {
  const clean = name.trim().replace(/^#/, '');
  if (!clean) throw new Error('empty tag');
  const existing = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(clean) as any;
  if (existing) return existing.id;
  return Number(db.prepare('INSERT INTO tags (name) VALUES (?)').run(clean).lastInsertRowid);
}

export function setTags(kind: 'dish' | 'recipe', id: number, names: string[]) {
  const table = kind === 'dish' ? 'dish_tags' : 'recipe_tags';
  const col = kind === 'dish' ? 'dish_id' : 'recipe_id';
  db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(id);
  const seen = new Set<number>();
  for (const raw of names) {
    if (!raw?.trim()) continue;
    const tagId = upsertTag(raw);
    if (seen.has(tagId)) continue;
    seen.add(tagId);
    db.prepare(`INSERT INTO ${table} (${col}, tag_id) VALUES (?, ?)`).run(id, tagId);
  }
  // Tags that are no longer attached to anything shouldn't linger in autocomplete.
  db.exec(`DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM dish_tags UNION SELECT tag_id FROM recipe_tags)`);
}

export function tagsFor(kind: 'dish' | 'recipe', id: number) {
  const table = kind === 'dish' ? 'dish_tags' : 'recipe_tags';
  const col = kind === 'dish' ? 'dish_id' : 'recipe_id';
  return db
    .prepare(`SELECT t.id, t.name FROM tags t JOIN ${table} x ON x.tag_id = t.id WHERE x.${col} = ? ORDER BY t.name`)
    .all(id) as { id: number; name: string }[];
}
