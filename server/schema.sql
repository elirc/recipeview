-- Recipe Lab schema. Three levels: dish -> recipe -> cook_log.
--
-- The cook_log table is deliberately NOT a "reviews" table. It carries the
-- deltas (what was different that night) alongside the ratings, because the
-- ratings are only meaningful in the context of the deltas. Splitting taste
-- notes from process notes is likewise deliberate: bland dough and torn dough
-- are unrelated problems and collapsing them loses the signal.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS dishes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dish_id     INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  -- Provenance: where this approach came from. Free text label + optional URL.
  source_name TEXT NOT NULL DEFAULT '',
  source_url  TEXT NOT NULL DEFAULT '',
  -- 'keeper' | 'needs-work' | 'abandoned' | 'untested'
  verdict     TEXT NOT NULL DEFAULT 'untested',
  -- Base yield the ingredient quantities are written for. Scaling is derived.
  yield_qty   REAL NOT NULL DEFAULT 1,
  yield_unit  TEXT NOT NULL DEFAULT 'serving',
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recipes_dish ON recipes(dish_id);

-- Ingredients are stored structured (qty/unit/item) rather than as a text blob
-- specifically so scaling can multiply qty without mangling the text.
CREATE TABLE IF NOT EXISTS ingredients (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  qty       REAL,              -- NULL for "to taste", "a pinch"
  unit      TEXT NOT NULL DEFAULT '',
  item      TEXT NOT NULL,
  note      TEXT NOT NULL DEFAULT '',
  -- Baker's-percentage style grouping ("Dough", "Sauce", "Toppings")
  section   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_ingredients_recipe ON ingredients(recipe_id, position);

CREATE TABLE IF NOT EXISTS steps (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  text      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_steps_recipe ON steps(recipe_id, position);

CREATE TABLE IF NOT EXISTS cook_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id      INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  cooked_on      TEXT NOT NULL,               -- YYYY-MM-DD
  -- THE point of the app: what was different from the base recipe this time.
  changes        TEXT NOT NULL DEFAULT '',
  taste_notes    TEXT NOT NULL DEFAULT '',
  process_notes  TEXT NOT NULL DEFAULT '',
  next_time      TEXT NOT NULL DEFAULT '',
  rating_taste   INTEGER,                     -- 1..5
  rating_texture INTEGER,                     -- 1..5
  rating_effort  INTEGER,                     -- 1..5, 5 = exhausting
  -- 'yes' | 'maybe' | 'no' | NULL
  make_again     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cook_logs_recipe ON cook_logs(recipe_id, cooked_on DESC);

CREATE TABLE IF NOT EXISTS photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cook_log_id INTEGER NOT NULL REFERENCES cook_logs(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  caption     TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_photos_log ON photos(cook_log_id, position);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS dish_tags (
  dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (dish_id, tag_id)
);

CREATE TABLE IF NOT EXISTS recipe_tags (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- Full-text search.
--
-- One contentful FTS5 table indexing every searchable row in the app,
-- discriminated by `kind`. Rebuilt explicitly on write (see db.ts), not via
-- triggers, because a recipe's searchable body spans four source tables.
-- `ref_id` is the id within that kind; `dish_id`/`recipe_id` let results link
-- back to a page without a second round of joins.
-- ---------------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  kind UNINDEXED,
  ref_id UNINDEXED,
  dish_id UNINDEXED,
  recipe_id UNINDEXED,
  title,
  body,
  tokenize = "unicode61 remove_diacritics 2"
);
