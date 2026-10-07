# Testing and debugging

[Course index](README.md)

## Run the checks

Use a Node version that ships `node:sqlite` (the delivery evidence used Node 22.16.0) and npm. From the project root:

```powershell
npm install
npm test
npm run typecheck
npm run build
```

`npm test` runs `tsx --test test/*.test.ts`. See the course [README](README.md#toolchain) for the Windows glob caveat and the shell-independent `npx tsx --test test/recipes.test.ts`.

## How the suite isolates itself

Read `test/recipes.test.ts:12-29`:

1. `mkdtemp` creates a fresh directory (`:13`).
2. `process.env.RECIPE_LAB_DATA` is set **before** `server/db.ts` is imported (`:14-15`). This order is load-bearing: `db.ts` opens the database at module load (`server/db.ts:12-15`). Import first and you write to your real `data/` folder.
3. `server/index.ts` is imported for its exported `app` (`:16`). Because of the guard at `server/index.ts:596-599`, importing does not start a listener on 5274; the test calls `app.listen(0, "127.0.0.1")` for a random free port (`:17-19`).
4. `after` closes the server, closes the database handle, then removes only the temporary directory (`:21-29`). Closing SQLite before `rm` matters on Windows, where an open file cannot be deleted.

The suite is therefore a real HTTP → Express → SQLite integration test. Nothing is mocked.

## What the suite proves — and what it does not

Proven (see the annotated table in chapter 3): partial PATCH preserves children; five classes of invalid PATCH write nothing; dish delete cascades and sweeps FTS rows; non-canonical ids are 400 and padded ids resolve.

Not covered by any test today (each is a place a regression could land unnoticed):

| Untested area | Code |
| --- | --- |
| Cook-log create/edit/delete, rating clamps, `cooked_on` fallback | `server/index.ts:381-493` |
| Photo upload, MIME filter, file cleanup on delete | `server/index.ts:497-566` |
| Search query building and ranking | `server/queries.ts:175-227` |
| Dish list sorting and tag filtering | `server/queries.ts:126-155` |
| "Best cook" selection and stats rollups | `server/queries.ts:7-30`, `:51-80` |
| Quantity parsing/formatting | `shared/quantity.ts` (no test file) |
| Any React component | `src/` (no client test runner is configured in `package.json`) |
| Recipe delete (only dish delete is tested) | `server/index.ts:354-377` |

`shared/quantity.ts` is the cheapest gap to close: it is pure, and its doc comments list the cases it claims to handle (`:26-28`: `"2"`, `"1.5"`, `"1 1/2"`, `"3/4"`, `"1½"`, `"½"`, `"2-3"`). Each is a one-line assertion.

## Debugging workflow

1. **Start at the server terminal.** A 500 always prints the real error there first (`server/index.ts:97`). The browser only ever sees `Request failed`.
2. Reproduce the smallest failing request with `curl` or a test, not the UI. Save the exact body in your notes.
3. Decide which layer rejected it. A 400 with a specific message came from `h()`/`validatePayload` or a handler's own guard (search for the message text). A 404 came from a handler's existence check. A 500 came from SQLite or a bug.
4. Put a breakpoint (or a temporary `console.log`) at `validatePayload` (`:602`) and inspect *types* as well as values — `"2"` and `2` look the same in a log line but take different branches at `:631`.
5. After a write, read the authoritative state: `GET` the resource, and for search problems query the FTS table directly, e.g. `SELECT kind, ref_id, title FROM search_index WHERE ref_id = ?` with the `sqlite3` CLI against `data/recipe-lab.db` (or your `RECIPE_LAB_DATA` directory).
6. Add a regression test that fails, make the smallest fix, re-run.

## Failure experiments

**Goal:** prove the transaction boundary. **Check:** with a temporary `throw` added at the end of `reindexRecipe` (`server/db.ts:55-82`), a recipe title PATCH returns 500 and a subsequent `GET /api/recipes/:id` still shows the old title and the old ingredient list. Remove the throw afterwards.

**Goal:** observe normalisation instead of rejection. **Check:** `POST /api/recipes/:id/logs` with `{ "cooked_on": "2026-13-45", "rating_taste": 9, "changes": 42 }` returns **201** (not 400) with `cooked_on` equal to today's UTC date, `rating_taste` 5 and `changes` `""` — matching `server/index.ts:394`, `:49-53` and `:41-42`.

**Goal:** observe a delete of a missing id. **Check:** `DELETE /api/recipes/999999` returns 204 even though no such recipe exists (`server/index.ts:354-377` has no existence check). Decide whether that is acceptable idempotency or a hidden typo.

**Goal:** observe an orphaned upload. **Check:** `POST /api/logs/999999/photos` with one JPEG returns 404, yet a new file appears in `<RECIPE_LAB_DATA>/photos` — multer's middleware (`:522`) runs before the handler's existence check (`:525-527`).

## Reading an assertion failure

`Expected 3, received 4` is evidence about one observation, not a diagnosis. Ask whether the fixture created an extra record, the operation ran twice, an old record survived, or the assertion read an unfiltered collection. Because these tests share state through module variables (`test/recipes.test.ts:6-11`), a failure in test 1 will cascade into tests 2 and 3; fix the first failure first.

## Verification record

[VERIFICATION.md](VERIFICATION.md) records the checks run when this course was delivered. Record your own command, date and result when practising. A passing suite does not cover the untested areas listed above.
