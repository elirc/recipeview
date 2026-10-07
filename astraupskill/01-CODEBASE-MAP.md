# Codebase map and reading order

[Course index](README.md)

## The problem this project solves

Recipe Lab is a single-user, local cooking journal: Dish → Recipe → Cook Log. The improvement this course studies is the **request boundary**: before the fix, nested recipe payloads could contain malformed ingredient/step values, blank edits were silently ignored, and ids were accepted by loose `Number()` conversions. Now a shared wrapper rejects malformed nested values and non-canonical ids before any handler writes; recipe edits keep children you did not send; and parent edit, child replacement and search re-indexing commit in one transaction. The app module can also be imported without binding a port (`server/index.ts:596-599`), which is what lets the tests start it on a random port.

## The whole server in one table

The server is four files. Learn their roles before reading any React.

| File | Lines | What it owns |
| --- | --- | --- |
| `server/schema.sql` | 124 | Tables, `ON DELETE CASCADE` foreign keys, `PRAGMA foreign_keys = ON` (`:10`), and the FTS5 `search_index` (`:116-124`) |
| `server/db.ts` | 153 | Opens the database at import time (`:12-15`), `tx()` (`:18-28`), the re-indexers (`:42-117`), tag upsert + orphan-tag sweep (`:123-145`) |
| `server/queries.ts` | 247 | Read-only: `statsFor` (`:19`), `cookLogsFor` (`:36`), `getRecipeDetail` with the "best cook" loop (`:51-80`), `dishRollup` (`:87`), `listDishes` (`:126`), `toFtsQuery` + `search` (`:175-227`) |
| `server/index.ts` | 668 | Every route, the `h()` wrapper (`:69-95`), `fail()` (`:96-102`), `writeRecipeChildren` (`:233-264`), multer config (`:497-518`), `validatePayload` (`:602-668`) |

Important: **all writes live in `server/index.ts`**. `queries.ts` has no update functions; handlers build their own `INSERT`/`UPDATE` statements and call the re-indexers from `db.ts`.

## Data model

```
dishes ──< recipes ──< cook_logs ──< photos
              ├──< ingredients (position, qty REAL NULL, unit, item, note, section)
              └──< steps (position, text)
tags ──< dish_tags / recipe_tags
search_index  (FTS5: kind, ref_id, dish_id, recipe_id UNINDEXED; title, body indexed)
```

- Every child table references its parent with `ON DELETE CASCADE` (`server/schema.sql:22,42,55,63,82`). Cascades only fire because `PRAGMA foreign_keys = ON` is executed on every start (`schema.sql:10`, applied by `db.ts:15`).
- `ingredients.qty` is nullable on purpose: NULL means "to taste" (`schema.sql:44`), and scaling leaves it blank (`shared/quantity.ts:127-130`).
- `search_index` is a virtual table, **not** a foreign-key target, so deleting a dish does not remove its search rows. Handlers delete them by hand (`server/index.ts:205-220`).
- Photo files live on disk under `RECIPE_LAB_DATA/photos` (`server/db.ts:7-10`); only their filenames are in SQLite.

## Trace one request end to end

Follow "rename a recipe" from click to commit:

1. `src/pages/RecipeEditor.tsx:63-82` builds the payload. Note it always sends the **full** ingredient and step lists, with blank rows filtered out (`:78-81`), and quantities parsed by `parseQty` (`:80`).
2. `src/api.ts:52-53` `updateRecipe` issues `PATCH /api/recipes/:id`; `req()` (`:11-28`) turns a non-2xx response into a thrown `Error` carrying the server's `error` text.
3. `server/index.ts:316` registers the route, wrapped in `h()`.
4. `h()` (`:69-95`) checks every param ending in `id` (`:73-81`), rewrites it to canonical form (`:83`), and for POST/PATCH calls `validatePayload` (`:85-89`). A throw here goes to `fail()` before the handler runs.
5. The handler checks the recipe exists (`:320-322`), then inside `tx()` builds a dynamic `UPDATE` from only the fields present (`:324-343`), calls `writeRecipeChildren` (`:344`), replaces tags if sent (`:345`) and calls `reindexRecipeTree` (`:348`).
6. `tx()` (`server/db.ts:18-28`) commits, or rolls back on any throw.
7. The response is a fresh `getRecipeDetail(id)` read (`server/index.ts:350`, `server/queries.ts:51-80`), and the editor hands it to the page with `setRecipe(r)` (`src/pages/RecipePage.tsx:255-258`) — the page shows what was committed, not what was typed.

## The client in one table

| File | Role |
| --- | --- |
| `src/App.tsx` | Routes `/`, `/dish/:id`, `/recipe/:id` (`:12-17`) and the top bar with theme toggle |
| `src/api.ts` | The only place that calls `fetch` |
| `src/pages/HomePage.tsx` | Dish list, sort segmented control, tag filter |
| `src/pages/DishPage.tsx` | Recipes of one dish side by side |
| `src/pages/RecipePage.tsx` | Ingredients with `ScaleControl` (`:366`), steps, `BestLogCallout` (`:336`), cook-log feed |
| `src/pages/*Editor.tsx` | Sheets that create/edit dishes, recipes and cook logs |
| `src/pages/CookLogCard.tsx` | One log entry, photo lightbox |
| `src/components/SearchBar.tsx` | Debounced (130 ms) search with stale-response guard (`:37-59`) and HTML-escaped snippets (`:12-19`) |
| `shared/quantity.ts`, `shared/types.ts` | Imported by both sides through the `@shared` alias (`vite.config.ts:9`) |

## Where to read first

1. `server/index.ts:69-102` (`h` and `fail`) and `:602-668` (`validatePayload`).
2. `server/index.ts:233-264` (`writeRecipeChildren`) and `:316-352` (recipe PATCH).
3. `server/db.ts:18-28` (`tx`) and `:42-110` (re-indexers).
4. `test/recipes.test.ts` — read the four test names before the helper code.

## A practical reading technique

At each function boundary, write down the value coming in, the value going out, and any side effect (SQL write, file write, network call, DOM update). Watch for **representation changes**: the quantity is a string in the editor (`RecipeEditor.tsx:9`), a `number | null` on the wire, and a `REAL` in SQLite; the route id is a string in `req.params` until `Number(...)` in each handler; `cooked_on` is a `YYYY-MM-DD` string, not a timestamp (`schema.sql:64`). Representation changes are where bugs cluster.

## Exercises

**Goal:** locate ownership without running anything.
**Check:** for each question, write a file:line answer. (a) Which line first rejects `PATCH /api/recipes/1e2`? → `server/index.ts:81`. (b) Which line deletes the old ingredients? → `server/index.ts:235`. (c) Which line makes the cascade actually fire? → `server/schema.sql:10`. (d) Which line decides that blank ingredient rows are dropped server-side? → `server/index.ts:239`.

**Goal:** find the one route that skips payload validation.
**Check:** you can name `POST /api/logs/:id/photos` and point at the `/photos` exclusion in `server/index.ts:86-88`, and explain why (multipart bodies are not JSON objects).

**Goal:** prove `queries.ts` is read-only.
**Check:** a search for `INSERT|UPDATE|DELETE` in `server/queries.ts` finds zero matches.

## Check your understanding

Who owns the mutable state? Which input is untrusted? Which function first decides whether the operation is valid? What survives restart (SQLite file + photo directory), and what does not (the client's `factor` state in `RecipePage.tsx:24`)? What observation would prove an operation partially failed — for example, a recipe row whose `search_index` row still has the old title?
