# 🧪 Recipe Lab

A local-first cooking journal built around a three-level hierarchy:

**Dish → Recipe → Cook Log**

- A **Dish** is what you want to make — *Pizza*, *Ramen*, *Chocolate chip cookies*. It's a container.
- A **Recipe** is one specific approach to that dish — *Neapolitan 65% hydration*, *Cast-iron pan pizza*. A dish has many recipes. Each has ingredients, steps, a source, and a verdict (keeper / needs work / abandoned / untested).
- A **Cook Log** is a single time you actually made that recipe. A recipe has many cook logs. This is the point of the app: the same recipe goes differently on different nights, and the log captures *why*.

This is a lab notebook, not Pinterest — dense, readable, keyboard-friendly, and fast to log a cook with messy hands.

## Why the cook log isn't a "review"

The tempting shortcut is to collapse cook logs into star ratings on the recipe. Recipe Lab deliberately doesn't. Each cook log keeps four things distinct:

- **What I changed** — the deltas from the base recipe (*"bread flour instead of 00 · fermented 72h"*). This is the headline of every entry.
- **Taste notes** and **process notes** — kept in separate fields, because bland dough and torn dough are unrelated problems.
- **Structured ratings** — taste, texture, effort, and would-make-again, each rated on its own axis.
- **Next time I should…** — one concrete change to try.

The result is the difference between *"this recipe is 4 stars"* and *"this recipe is 4 stars **when you cold-ferment it**."* The recipe page surfaces the single best cook and what made it best.

## Stack

- **Frontend** — React 18 + Vite + TypeScript, React Router. No component library; a small hand-rolled design system with light/dark themes.
- **Backend** — Express + Node's built-in `node:sqlite` (no native compilation). Full-text search via SQLite **FTS5**.
- **Storage** — a single SQLite file plus an uploaded-photos folder, both under `data/` (git-ignored). Fully local; no accounts, no network.

## Features

- Three-level navigation: home (dishes) → dish (recipes side by side with average ratings + verdicts) → recipe (full text + reverse-chronological cook-log feed). Routes are declared in `src/App.tsx:12-17`.
- **Full-text search** across dishes, recipes, ingredients, steps, and every cook-log note. `⌘K` / `Ctrl-K` (or `/` when you are not typing) focuses it from anywhere (`src/components/SearchBar.tsx:62-72`); arrow keys + Enter navigate hits.
- **Tags** on dishes and recipes, with a tag filter on the home page and autocomplete in the editors.
- **Ingredient scaling** — quantities parse human input (`1½`, `3/4`, `2-3`) via `shared/quantity.ts` and render back to kitchen-legible fractions when scaled with the ½×–3× presets on the recipe page.
- **Photos** on cook logs, with a lightbox.
- `⌘Enter` saves in the dish editor's notes field and anywhere in the cook-log editor (`src/pages/DishEditor.tsx:68`, `src/pages/CookLogEditor.tsx:128`). In the recipe editor, `⌘Enter` inside a step adds a new step instead (`src/pages/RecipeEditor.tsx:243-247`). Sticky stats rail, responsive down to phone width.

## Getting started

Requires a Node version that ships `node:sqlite` (the course material in `astraupskill/` was verified on Node 22.16).

```bash
npm install
npm run seed     # optional: populate a realistic demo journal
npm run dev      # web on http://localhost:5273, API on :5274
```

Open **http://localhost:5273**. Vite proxies `/api` and `/photos` to the API (`vite.config.ts:11-17`).

### Other scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server + API (`tsx watch`) via `concurrently` |
| `npm run seed` | Wipe and repopulate the database with demo data (`server/seed.ts`) |
| `npm run build` | Production build of the web bundle into `dist/web` |
| `npm start` | Serve the built app + API from a single Express process |
| `npm run typecheck` | `tsc --noEmit` across client, server, and shared code |
| `npm test` | `tsx --test test/*.test.ts` — HTTP tests against a throwaway SQLite directory |

### Environment variables

| Variable | Default | Read at |
| --- | --- | --- |
| `PORT` | `5274` | `server/index.ts:35` |
| `RECIPE_LAB_DATA` | `<repo>/data` | `server/db.ts:7` — holds `recipe-lab.db` and `photos/` |

The database opens **at import time** (`server/db.ts:12-15`), so `RECIPE_LAB_DATA` must be set before `server/db.ts` is first imported. The test suite relies on this (`test/recipes.test.ts:13-15`).

## Project layout

| Path | Responsibility |
| --- | --- |
| `server/schema.sql` | Tables, cascades, the FTS5 `search_index` (applied on every start with `CREATE ... IF NOT EXISTS`) |
| `server/db.ts` | Opens SQLite, `tx()` helper, search re-indexing, tag upsert/cleanup |
| `server/queries.ts` | Read-side: rollups, recipe detail, "best cook", dish list sorting, FTS query building |
| `server/index.ts` | Every HTTP route, the `h()` wrapper (id + payload validation), photo upload, static hosting |
| `server/seed.ts` | Demo data |
| `shared/types.ts` | Wire types shared by client and server, `cookScore()` |
| `shared/quantity.ts` | `parseQty` / `formatQty` / `scaleQty` |
| `src/` | React client: `api.ts` (fetch wrapper), `pages/` (Home, Dish, Recipe, editors, cook-log card), `components/` |
| `test/recipes.test.ts` | Four HTTP-level regression tests |

## API

All JSON. Path ids must be positive whole numbers; anything else (`1e2`, `-1`, `1.5`) is a 400 before the handler runs (`server/index.ts:73-83`).

| Method + path | Handler | Notes |
| --- | --- | --- |
| `GET /api/dishes?tag=&sort=recent\|name\|cooks` | `index.ts:106` | Rollups computed per dish in `queries.ts:87-122` |
| `POST /api/dishes` | `index.ts:115` | `{ name, notes?, tags? }` → 201 |
| `GET/PATCH/DELETE /api/dishes/:id` | `index.ts:134`, `:143`, `:193` | DELETE cascades and sweeps photo files after commit |
| `POST /api/dishes/:dishId/recipes` | `index.ts:266` | Ingredients + steps written in the same transaction |
| `GET/PATCH/DELETE /api/recipes/:id` | `index.ts:307`, `:316`, `:354` | PATCH: omitted `ingredients`/`steps` are kept; a sent array replaces the list |
| `GET/POST /api/recipes/:id/logs` | `index.ts:381`, `:386` | |
| `PATCH/DELETE /api/logs/:id` | `index.ts:427`, `:474` | |
| `POST /api/logs/:id/photos` | `index.ts:520` | multipart field `photos`, ≤12 files, ≤15 MB each, image MIME types only |
| `DELETE /api/photos/:id` | `index.ts:556` | |
| `GET /api/search?q=` | `index.ts:575` → `queries.ts:185` | FTS5, title weighted 10× body |
| `GET /api/tags` | `index.ts:580` | With use counts |

Errors: `InputError` → 400 with a message; anything else → 500 `{"error":"Request failed"}` and the real error on the server console (`server/index.ts:96-102`).

## Data model

```
dishes ──< recipes ──< cook_logs ──< photos
              │
              ├──< ingredients   (structured qty/unit/item, for scaling)
              └──< steps
tags ──< dish_tags / recipe_tags
search_index (FTS5, rebuilt on every write)
```

Deleting a dish cascades to its recipes, their cook logs, and photos (rows via `ON DELETE CASCADE`, photo files and search rows swept explicitly).

Search is not maintained by triggers: each write handler calls `reindexDish` / `reindexRecipe` / `reindexCookLog` (`server/db.ts:42-102`) inside the same transaction as the row change. A recipe rename also re-indexes every cook log under it, because log search titles embed the recipe title (`reindexRecipeTree`, `server/db.ts:105-110`).

## Known limitations

These are visible in the code today; see `astraupskill/06-SOLUTIONS-AND-REVIEW.md` for the full review.

- Cook-log text fields are not covered by `validatePayload` (`server/index.ts:602-668`): a non-string `changes` becomes `""`, an invalid `cooked_on` silently becomes today on create (`:394`) and is ignored on edit (`:444-445`).
- Deleting a cook log removes its photo files *inside* the transaction (`server/index.ts:480-484`), unlike dish/recipe deletes, which defer file removal until after commit.
- A photo upload to a missing cook log returns 404, but multer has already written the files to `data/photos` (`server/index.ts:522-527`).
- `source_url` is rendered as a link with no scheme check (`src/pages/RecipePage.tsx:120-121`).
- The home tag filter lists recipe tags too (`/api/tags` counts both), but filtering only matches dish tags (`server/queries.ts:129-131`).

## Out of scope for v1

Meal planning, grocery lists, nutrition data, multi-user accounts, sharing.

## Junior SWE learning course

[Start the detailed Astra upskilling course](astraupskill/README.md): parent-child CRUD, partial edits and SQLite transactions, with a codebase map, worked implementation, executable examples, debugging labs, exercises and solution discussions.
