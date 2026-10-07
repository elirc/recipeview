# Concepts explained from first principles

[Course index](README.md)

## 1. Replace-the-children, and what "omitted" means

A recipe editor submits a complete ingredient list, so replacing children wholesale is easier to get right than diffing rows. `writeRecipeChildren` (`server/index.ts:233-264`) does exactly that: if `body.ingredients` is an array, it deletes every ingredient for the recipe (`:235`) and re-inserts the non-blank rows with fresh `position` values (`:236-251`). Steps work the same way (`:253-263`).

The contract has three cases, and each is a different branch:

| Payload | Branch | Result |
| --- | --- | --- |
| no `ingredients` key | `Array.isArray` is false (`:234`) | Existing rows untouched |
| `ingredients: []` | Array, loop runs zero times | All ingredients removed — intentional |
| `ingredients: [{item:"Salt",qty:-1}]` | Rejected earlier by `validatePayload` (`:645-655`) | 400, nothing deleted |

The third row is the reason validation must happen **before** the delete. If `validatePayload` ran after line 235, a typo would wipe an otherwise valid recipe. It runs in `h()` (`:85-89`), before the handler is even called.

Two consequences worth noticing:

- Ingredient ids are **not stable** across edits: every save deletes and re-inserts, so `ingredients.id` changes each time. Nothing in the app references ingredient ids today, which is why this is acceptable (see practice exercise 4).
- Blank rows are dropped twice: the editor filters them (`src/pages/RecipeEditor.tsx:79`), and the server skips them again (`server/index.ts:239`, `:258`). The server check is the one that matters for API callers.

## 2. Transactions with `node:sqlite`

`tx(fn)` (`server/db.ts:18-28`) is four lines of real logic: `BEGIN`, run `fn`, `COMMIT`, or `ROLLBACK` and rethrow. It is correct here for two reasons that do not carry over to other stacks:

1. `DatabaseSync` is **synchronous**. `fn` cannot `await`, so no other request can run between `BEGIN` and `COMMIT` in this process. With an async driver (e.g. `pg`), the same helper would need a dedicated client per transaction.
2. There is one process and one connection. `tx` is **not re-entrant**: calling `tx` inside `tx` would issue a second `BEGIN` and SQLite would throw "cannot start a transaction within a transaction". No code path does that today.

What the transaction covers in a recipe PATCH (`server/index.ts:323-349`): the parent `UPDATE`, child replacement, tag replacement and `reindexRecipeTree`. What it cannot cover: files on disk. That is why dish and recipe deletes collect photo filenames **inside** the transaction and remove files **after** it commits (`:197-224`, `:358-374`). Read the cook-log delete (`:474-493`) and you will see it does not follow that pattern — a finding discussed in chapter 6.

## 3. Search as a second representation of the same data

`search_index` is a single FTS5 table holding three kinds of rows (`server/schema.sql:116-124`). The schema comment explains why there are no triggers: a recipe's searchable body spans four source tables (recipe, ingredients, steps, tags). Instead, each handler calls a re-indexer, and each re-indexer is "delete my row, rebuild it from source" (`server/db.ts:38-53`).

The subtle part is **denormalised titles**. A cook log's search title is `` `${recipe_title} — ${cooked_on}` `` (`db.ts:101`). So renaming a recipe must re-index every cook log under it: that is `reindexRecipeTree` (`db.ts:105-110`), called from the recipe PATCH (`index.ts:348`). A dish rename does not cascade, because dish names are resolved live at query time (`queries.ts:209-215`, comment at `index.ts:165-166`).

User text reaches FTS5 through `toFtsQuery` (`queries.ts:175-183`): it strips double quotes, wraps each term in quotes (so `don't` or `half-and-half` is not parsed as FTS syntax), and adds `*` to the last term for prefix matching. `bm25(search_index, 0, 0, 0, 0, 10.0, 1.0)` (`:196`) weights a title hit ten times a body hit. A query that still fails to parse is caught and returns `[]` rather than a 500 (`:203-207`).

## 4. Validation versus normalisation

Validation rejects; normalisation converts. This codebase does both, and the line between them is a design decision you should be able to defend.

| Field | Treatment | Where |
| --- | --- | --- |
| Route id `01` | Validated (digits, safe integer, ≥ 1), then normalised to `1` | `index.ts:73-83` |
| `name` / `title` blank | **Rejected** (400) | `index.ts:618` |
| `yield_qty` ≤ 0 or non-number | **Rejected** | `index.ts:629-635` |
| Ingredient `qty` negative | **Rejected**; `null`/`""` allowed as "to taste" | `index.ts:645-655` |
| `verdict: "great"` | **Normalised** to `untested` | `index.ts:54-55` |
| `rating_taste: 9` | **Normalised** (clamped to 5) | `index.ts:49-53` |
| `cooked_on: "yesterday"` on create | **Normalised** to today | `index.ts:394` |
| `changes: 42` on a cook log | **Normalised** to `""` by `str()` | `index.ts:41-42`, `:408` |

The bottom half of the table is where silent data loss lives. `validatePayload` covers dish and recipe fields only; cook-log fields never reach a rejection branch. Ask: would a user rather get a 400, or have their note replaced by an empty string?

## 5. Aggregates are derived, not stored

No rating is stored on a recipe or dish. `STATS_SQL` (`queries.ts:7-17`) averages cook logs on every read; `make_again` text is weighted yes=1, maybe=0.5, no=0 in SQL (`:13`). The "best cook" is chosen in TypeScript with `cookScore` (`shared/types.ts:147-151`, used at `queries.ts:59-68`) — mean of taste and texture, effort deliberately excluded. Ties go to the first log in `cookLogsFor` order, i.e. the most recent (`queries.ts:40`, strict `>` at `:64`).

The dish-level `best_score` (`queries.ts:103-111`) is computed differently: it averages taste over all logs and texture over all logs per recipe, then means those two averages. That is not always equal to the best per-cook `cookScore`. Being able to say *why two numbers on two pages disagree* is a senior skill.

## 6. Identity and representation

Keep a stable id when updating a record. Convert between strings and numbers deliberately: `Number('')` is `0`, which is why `num()` special-cases `""` and `null` (`index.ts:43-47`) instead of calling `Number` directly. `cooked_on` is a calendar label, not an instant; `isDate` (`:59-62`) round-trips through `toISOString()` so `2026-02-30` is rejected rather than rolled over to March.

## Exercises

**Goal:** predict the three `ingredients` cases. **Check:** for a recipe with 2 ingredients, write the ingredient count after PATCH `{title:"x"}` (2), PATCH `{ingredients:[]}` (0), and PATCH `{ingredients:[{item:"a",qty:-1}]}` (2, status 400). Then confirm against `test/recipes.test.ts:55-67`.

**Goal:** explain a denormalisation. **Check:** you can name the exact line (`server/db.ts:101`) that forces `reindexRecipeTree`, and predict which search title changes when a *dish* is renamed (none — only the dish row is re-indexed, `server/index.ts:164`).

**Goal:** classify a field. **Check:** for `make_again: "sometimes"`, cite the line that decides its fate (`server/index.ts:56-57`) and state the stored value (`NULL`).
