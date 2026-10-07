# Trace lab: validate a nested edit before replacing children

[Course index](README.md) · [Worked change](03-WORKED-CHANGE.md) · [Tests](04-TESTING-AND-DEBUGGING.md)

## Run it before you trace it

Run `npm test` (or `npx tsx --test test/recipes.test.ts`) and keep [`test/recipes.test.ts`](../test/recipes.test.ts) open. Every boundary below is traced with the requests those four tests send. If you want to see server logs, add a temporary `console.log` in `h()` (`server/index.ts:72`) — the tests start the real app in-process, so its logs appear in the test output.

## The concrete case

Create *Pasta* → recipe *Weeknight* (one ingredient `Pasta 100 g`, one step `Boil water`, yield 2). PATCH title only. PATCH with a negative quantity (rejected). Delete the dish.

## Write the record before touching anything

Make a table in your notes: field, starting value, proposed value, source of truth. For this case:

| Field | After create | After PATCH `{title:"Renamed"}` | After rejected PATCH | Source of truth |
| --- | --- | --- | --- | --- |
| `recipes.title` | Weeknight | Renamed | Renamed | `recipes` row |
| `recipes.updated_at` | create time | new `datetime('now')` (`index.ts:341`) | unchanged | `recipes` row |
| ingredient count | 1 | 1 | 1 | `ingredients` |
| ingredient `id` | n | n (array omitted → no delete) | n | `ingredients` |
| `search_index` recipe title | Weeknight | Renamed | Renamed | re-derived by `reindexRecipe` |
| recipe `stats.cook_count` | 0 | 0 | 0 | **derived** (`queries.ts:7-17`) |

Mark `stats` as derived: no column stores it, so it cannot drift.

## Trace the real call path

### Boundary 1 — the editor decides what to send

`src/pages/RecipeEditor.tsx:63-82`. Form state holds quantities as **strings** (`IngRow`, `:9`). On save, blank-item rows are filtered (`:79`) and each quantity goes through `parseQty` (`:80`), so the wire value is `number | null`. Steps are sent as plain strings (`:81`); the server accepts either strings or `{text}` objects (`server/index.ts:257`). The UI editor always sends the full `ingredients` and `steps` arrays — the "omit to preserve" branch is reachable only from API callers such as the tests.

### Boundary 2 — the request leaves the browser

`src/api.ts:52-53`: `updateRecipe(id, body)` is `PATCH /api/recipes/:id`. The shared `req()` helper (`:11-28`) sets the JSON header unless the body is `FormData` (`:13`), and on a non-2xx response throws an `Error` whose message is the server's `error` field (`:16-25`). Because `fail()` hides non-input errors, the client can show only a validation message or `Request failed`.

### Boundary 3 — `h()` validates ids and payloads before any handler

`server/index.ts:69-95`. Any `req.params` key ending in `id` must be digits, a safe integer and ≥ 1 (`:73-81`), then is rewritten to canonical form (`:83`). For POST/PATCH (not `/photos`), `validatePayload` runs (`:85-89`, defined at `:602`). A throw goes to `fail()` (`:93`) and the handler never runs.

### Boundary 4 — the handler applies the change

The PATCH handler is inline in `server/index.ts:316-352` — there is no `updateRecipe` function in `queries.ts`; that file is read-only. The handler checks existence (`:320-322`), builds a dynamic `UPDATE` containing only the fields present (`:324-343`), calls `writeRecipeChildren` (`:344`, defined `:233-264`), replaces tags if sent (`:345`) and re-indexes the recipe and its logs (`:348`). For a dish rename the analogous code is `:143-170`, re-indexing only the dish row via `reindexDish` (`server/db.ts:42-53`).

### Boundary 5 — `tx()` commits rows and search together

`server/db.ts:18-28`: `BEGIN`, the synchronous body, `COMMIT`; `ROLLBACK` and rethrow on any error. Because `DatabaseSync` is synchronous, no other request can interleave inside the body. Photo files are outside the transaction and have their own lifecycle (chapter 2, §2).

### Boundary 6 — the response tells the client what happened

The handler answers `res.json(getRecipeDetail(id))` (`:350`) — a fresh read after commit. `fail()` (`:96-102`) answers 400 `{error}` for `InputError` and 500 `{error:"Request failed"}` otherwise. On success, the recipe page replaces its state with the returned detail (`src/pages/RecipePage.tsx:255-258`); it does not re-fetch. Cook-log saves, by contrast, call `load()` to re-fetch (`:265-268`, `:281-284`).

## Predict the regression scenarios

| Test | Your prediction should include |
| --- | --- |
| `:38` create + partial edit | Two 201s, one 200; ingredient and step text unchanged after the title PATCH |
| `:55` invalid edits | Which validator line rejects each of the five bodies: blank title `:618`; negative qty `:645-655`; `steps:[null]` `:658-667`; `tags:[{}]` `:622-628`; `yield_qty:0` `:629-635`. Plus `GET /recipes/1e2` rejected at `:81` |
| `:68` dish delete | 204; recipe 404 because of `ON DELETE CASCADE` (`schema.sql:22`); FTS rows 0 because of the manual sweep (`index.ts:205-220`) |
| `:81` canonical ids | Four 400s; `PATCH {name:5}` → 400 at `:615-620` and the dish's FTS title unchanged; `0<id>` → 200 with the same id |

Note the tests share fixture state through module variables (`:6-11`); explain why test 4 creates its own dish (`:84-85`).

## A rejected request, described precisely

Change one value to a rejected case and keep everything else identical. Predict which line rejects it. Run it and capture both the response and the authoritative state afterwards. Different failures produce different results in this API: invalid input → 400 from `h()`/`validatePayload`; missing parent on create or edit → 404 from the handler; missing record on DELETE → **204** (no existence check); SQLite or code error → 500. Do not assume they all look alike.

## Read the storage boundary

Place one breakpoint at `server/index.ts:324` (first line inside the PATCH transaction) and one at `:350` (response). On the success path, step through and watch `sets`/`vals` accumulate. On a rejected-input path, the first breakpoint is never reached — that is the observable form of "rejected before write". On a forced-failure path (chapter 3, boundary variation) you will reach statements that execute and are then undone by `ROLLBACK`; reaching a write does not mean it committed.

## Explain the design tradeoff

Replacing children wholesale is simple and matches how the editor submits, but it is only safe because validation precedes the delete and the whole thing is one transaction. It costs stable ingredient ids. Rebuilding FTS rows on every write avoids four tables of triggers but makes every handler responsible for calling the right re-indexer — and the cook-log and photo paths show what happens when one handler diverges from the pattern (chapter 6, findings 1 and 8).

## Change one requirement independently

**Goal:** make `DELETE /api/recipes/:id` return 404 for a missing recipe.
**Check:** a new test asserts `DELETE /api/recipes/999999` is 404, an existing recipe still deletes with 204, and the dish delete test still passes. Decide whether DELETE should be idempotent before writing it, and record the decision.

## Debug a disagreement between layers

If the form and response disagree, inspect the request payload in the Network panel before touching server code (e.g. a quantity you typed as `2 cups` was sent as `2`). If the response and database disagree, inspect the handler's `sets` list and the read query. If a test fails before any request, inspect startup: `RECIPE_LAB_DATA` set too late, a Node without `node:sqlite`, or the glob problem described in the course README.

## Final independent checkpoint

Close this guide. Using only the source and one test, explain: the input contract, the identity model (which ids are stable, which are not), the write boundary, one failed operation and one remaining limitation. Then change one value in the fixture and predict the result before running it.

[VERIFICATION.md](VERIFICATION.md) records this delivery's evidence; exercises remain learner work.
