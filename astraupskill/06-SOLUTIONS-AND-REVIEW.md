# Solutions and engineering review

[Course index](README.md) · [Practice prompts](05-PRACTICE.md)

Attempt each exercise first. These are solution approaches and review criteria, not claims that any extension has been implemented; the code in this repository contains only the worked change from chapter 3.

## Existing implementation, in one paragraph

`h()` (`server/index.ts:69-95`) validates and canonicalises route ids and runs `validatePayload` (`:602-668`) on every JSON POST/PATCH before the handler executes. Recipe PATCH (`:316-352`) only replaces children whose arrays are present, and runs the parent update, child replacement, tag replacement and `reindexRecipeTree` inside one `tx()` (`server/db.ts:18-28`). The module exports `app` and only listens when run directly (`server/index.ts:596-599`).

## Extension solutions

### Exercise 1 — inline ingredient validation
**Approach:** keep the raw string in `IngRow.qty`; compute `parseQty(row.qty)` per row at render time; a row is invalid when `row.qty.trim() !== ''` and the parse is `null`. Block `save()` when any row is invalid.
**Review:** the raw text must stay in the input (do not "fix" it for the user); blank must remain valid ("to taste", `server/schema.sql:44`); the server stays the authority — a direct API call with `qty: -1` must still get 400 from `server/index.ts:645-655`.

### Exercise 2 — scaled preview
**Approach:** `factor` is already component state (`src/pages/RecipePage.tsx:24`); add a numeric input that calls the same `onChange`. Reject `≤ 0` and non-finite input locally.
**Review:** no `api.*` call is reachable from the input handler; `formatQty` (`shared/quantity.ts:82-113`) does the rounding, so do not re-implement fractions.

### Exercise 3 — rollback test
**Approach:** SQLite does not allow triggers on virtual tables, so you cannot make `search_index` itself raise. Two workable options: (a) a test-only hook — e.g. an exported `let failNextReindex = false` in `server/db.ts` that `reindexRecipe` checks and throws on; or (b) a `BEFORE UPDATE ON recipes` temp trigger that raises, which proves rollback of the parent write (but fails earlier than the search write). Option (a) tests exactly the scenario named; remove or guard the hook so production code cannot set it.
**Review:** assert the 500, then deep-equal the snapshot. Explain that `ROLLBACK` at `server/db.ts:25` undid the `UPDATE recipes` and the `DELETE FROM ingredients` that had already executed.

### Exercise 4 — stable child ids
**Review criteria:** client sends `id` for existing rows and omits it for new ones; server `UPDATE ... WHERE id = ? AND recipe_id = ?` and rejects a row whose id belongs to another recipe (otherwise one recipe could edit another's ingredients); rows missing from the payload are deleted; `position` is rewritten from array order; concurrent reorders resolve last-write-wins unless you add a version column to `recipes` and compare it in the `UPDATE`.

### Exercise 5 — cook-log delete ordering
```typescript
const orphans = tx(() => {
  const files = (db.prepare("SELECT filename FROM photos WHERE cook_log_id = ?").all(id) as any[])
    .map((p) => p.filename);
  db.prepare("DELETE FROM search_index WHERE kind = ? AND ref_id = ?").run("cook_log", id);
  db.prepare("DELETE FROM cook_logs WHERE id = ?").run(id);
  return files;
});
removePhotoFiles(orphans);
```
**Review:** identical shape to the recipe delete (`server/index.ts:358-374`). File removal is still best-effort (`fs.rm` callback ignores errors, `:190`), so a failure leaves an orphan file rather than a dangling row — the safer direction.

### Exercise 6 — cook-log validation
**Review:** put the new checks in `validatePayload` so they share the "reject before write" guarantee. Watch the interaction with normalisation helpers: once a rating is validated as 1–5, `rating()`'s clamp (`:49-53`) becomes dead code for valid requests — keep or remove it deliberately. `cooked_on` validation must reuse `isDate` (`:59-62`) so the rules cannot drift.

### Exercise 7 — orphaned uploads
**Approach A:** a small middleware before `upload.array` that 404s when the cook log does not exist. **Approach B:** on the 404 path, `removePhotoFiles(files.map(f => f.filename))`. A is cleaner (nothing is written); B also covers a failure inside the insert `tx()` (`:529-543`) if you add it to a `catch`.

### Exercise 8 — double submit
`if (saving) return;` at the top of `save()` (`src/pages/CookLogEditor.tsx:56`) is not quite enough, because two keydown events in the same tick both see the old state. Use a ref (`const inFlight = useRef(false)`) checked and set synchronously. **Check** with throttling as described.

### Exercise 9 — ownership
```typescript
class ForbiddenError extends Error {}
class AuthError extends Error {}
// in fail(): AuthError -> 401, ForbiddenError -> 403, InputError -> 400, else 500
function requireOwner(req: express.Request, dishId: number) {
  const row = db.prepare("SELECT owner FROM dishes WHERE id = ?").get(dishId) as { owner: string } | undefined;
  if (!row) return; // let the handler's own 404 run
  if (row.owner !== (req as any).actor) throw new ForbiddenError("Only the owner can change this dish.");
}
```
**Review:** the check can safely be a separate read before `tx()` because `node:sqlite` is synchronous and single-connection — nothing can interleave. With PostgreSQL and an async driver, it must move inside the transaction (or use `SELECT ... FOR UPDATE`). GETs remain public — say so explicitly, since today every dish is readable by anyone who can reach the port.

## Senior review findings

These are observations of the code as it stands. Severity reflects a single-user local app; several would be serious in a shared deployment.

| # | Finding | Where | Severity |
| --- | --- | --- | --- |
| 1 | Cook-log delete removes photo **files** inside the transaction; a rollback would leave rows pointing at deleted files. Dish/recipe deletes do this correctly. | `server/index.ts:478-484` vs `:197-224` | Medium |
| 2 | Photo upload writes files before checking the cook log exists; 404 leaves orphans. | `server/index.ts:522-527` | Low |
| 3 | Cook-log fields are normalised, never rejected: non-string text → `""`, bad date → today (create) or silently ignored (edit), ratings clamped. Silent data loss for API callers. | `server/index.ts:394`, `:444-445`, `:41-53` | Medium |
| 4 | `source_url` is stored unchecked (any string ≤ 20,000 chars) and rendered as `<a href>`; a `javascript:` URL is clickable. React 18 logs a warning but still renders it. | `server/index.ts:606-620`, `src/pages/RecipePage.tsx:120-121` | Medium (would be high multi-user) |
| 5 | DELETE on a missing dish/recipe/log returns 204, and `GET /api/recipes/:id/logs` returns `[]` for a missing recipe. Typos are invisible. | `server/index.ts:193-227`, `:354-377`, `:474-493`, `:381-384` | Low |
| 6 | `⌘Enter` in the cook-log editor bypasses the `saving` guard → duplicate log on a slow first save. | `src/pages/CookLogEditor.tsx:128`, `:71-73` | Low |
| 7 | Home tag filter shows recipe-only tags (`allTags` counts both), but `listDishes` filters on `dish_tags` only, so clicking a recipe tag always shows "No dishes tagged". | `server/queries.ts:238-247`, `:129-131`, `src/pages/HomePage.tsx:83-85` | Low (UX bug) |
| 8 | `DELETE /api/photos/:id` is not transactional and does not re-index the log, while `reindexCookLog` indexes photo captions. Today nothing writes captions (no endpoint sets `caption`), so caption indexing is dead code that would go stale the day captions ship. | `server/index.ts:556-566`, `server/db.ts:93-98` | Info |
| 9 | N+1 reads: `listDishes` runs ~3 queries per dish (`dishRollup` + `tagsFor`), `search` runs up to 2 per hit for context. Fine at journal scale; would not be at 10k dishes. | `server/queries.ts:87-122`, `:135`, `:209-215` | Info |
| 10 | `npm run seed` deletes `photos` rows but not files in `data/photos`. | `server/seed.ts:7-11` | Info |
| 11 | Test blind spots: no tests for cook logs, photos, search, sorting, quantity parsing or any React component. | see chapter 4 | Medium |

No authentication exists at all, and `app.listen(PORT)` (`server/index.ts:597`) passes no host, so Node binds every interface, not just `localhost`. On a shared network the journal is readable and writable by anyone who can reach port 5274. Binding to `127.0.0.1` is the first thing to change before running it anywhere but your own machine.

## Review questions with answer guidance

**Why not trust input just because it came from this UI?** The editor already filters blank rows and parses quantities, yet the server repeats both checks (`server/index.ts:239`, `:645-655`) because `curl` bypasses the editor.

**Why keep the id stable?** It identifies the same record across views and edits. Ingredient ids are the counter-example in this codebase: they are not stable, which is fine only because nothing references them.

**What makes the failure test meaningful?** Test 2 snapshots the full recipe detail and deep-equals it after five rejected PATCHes (`test/recipes.test.ts:56`, `:65`). A test that only checked the 400 status would pass even if validation ran after the delete.

**What does the suite not prove?** Name it concretely: cook logs, photos and search have zero tests.

## A sample change explanation

"Previously, nested recipe payloads could contain malformed values and loosely parsed ids. Now `h()` rejects non-canonical ids and calls `validatePayload` before any handler writes, recipe PATCH keeps omitted children, and parent, children and FTS rows commit together in `tx()`. Evidence: `test/recipes.test.ts` test 2 deep-equals the recipe after five rejected edits. Remaining limits: cook-log fields are normalised rather than validated, and the cook-log delete removes files before commit."

Replace that with your own words and your own test results.
