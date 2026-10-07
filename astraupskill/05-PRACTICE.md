# Guided and independent practice

[Course index](README.md) · [Solutions](06-SOLUTIONS-AND-REVIEW.md)

Every exercise has a **Goal** and a **Check**. A Check is something you can observe — a status code, a row count, a file on disk, a failing-then-passing test — not "it works".

## Exercise 0 — reconstruct the existing behaviour

**Goal:** trace the worked fixture (chapter 3) on paper before running it.
**Check:** your written prediction lists, for each of the four tests in `test/recipes.test.ts`, the expected status codes and the row counts of `ingredients`, `steps` and `search_index` after each request. Run `npm test`; every prediction matches, or you can name the line where your model was wrong.

## Exercise 1 — guided: show ingredient validation beside the offending row

Today an unparseable quantity (e.g. `"abc"`) is silently sent as `null` by `parseQty` (`src/pages/RecipeEditor.tsx:80`), and a server 400 is shown as a toast (`:87-89`), not next to the row.

**Goal:** when a row's quantity text is non-empty but `parseQty` returns `null`, show an inline error on that row and do not submit.
**Check:** typing `abc` in a qty box and pressing *Save recipe* shows a message adjacent to that row; the Network panel shows **no** PATCH; clearing the box (blank = "to taste") allows the save.

## Exercise 2 — independent: preview scaled quantities without saving

The recipe page already scales for display (`src/pages/RecipePage.tsx:24`, `ScaleControl` at `:366`, `scaleQty` at `:416`).

**Goal:** add a free-form multiplier input next to the presets (`shared/quantity.ts:136`), still display-only.
**Check:** entering `1.25` shows scaled quantities and `→ <yield> <unit>`; reloading the page resets to 1×; the Network panel shows no write request while you change the multiplier.

## Exercise 3 — failure-focused: prove a recipe edit rolls back

**Goal:** add a test that forces a search-index failure during a recipe PATCH.
**Check:** the new test asserts a 500 and then that `GET /api/recipes/:id` deep-equals the pre-request snapshot (title, ingredients, steps). With the forced failure removed, the same request returns 200. Name the line in `server/db.ts` that ran `ROLLBACK` (`:25`).

## Exercise 4 — stretch design: stable ingredient ids

`writeRecipeChildren` deletes and re-inserts every row (`server/index.ts:235-251`), so ingredient ids change on every save.

**Goal:** a one-page design for create/update/delete keyed by ingredient id.
**Check:** your design states (a) how the client sends ids for existing rows, (b) how the server rejects an id that belongs to a different recipe, (c) how `position` is kept separate from identity, and (d) what happens if two tabs save different orders.

## Exercise 5 — fix the cook-log delete ordering

`DELETE /api/logs/:id` removes photo files *inside* `tx()` (`server/index.ts:478-484`), so a rollback would leave rows pointing at deleted files. The dish and recipe deletes already collect-then-remove-after-commit (`:197-224`).

**Goal:** make the cook-log delete follow the same pattern using `removePhotoFiles` (`:188-191`).
**Check:** after your change, the `fs.rm` call is lexically outside the `tx(() => ...)` callback; a new test creates a log, uploads one image, deletes the log, and asserts both 204 and that the file no longer exists in the temp `photos` directory.

## Exercise 6 — validate cook-log payloads

**Goal:** extend `validatePayload` (`server/index.ts:602-668`) so cook-log text fields must be strings, ratings must be integers 1–5 or `null`, `make_again` must be one of `MAKE_AGAIN` or `null`, and a present `cooked_on` must pass `isDate`.
**Check:** `POST /api/recipes/:id/logs` with `{ "rating_taste": 9 }` now returns 400 with a specific message; `{ "rating_taste": 4 }` still returns 201; the existing four tests still pass. Decide and document whether out-of-range values from older clients should still be clamped.

## Exercise 7 — clean up orphaned uploads

**Goal:** a photo upload to a missing cook log must not leave files on disk.
**Check:** `POST /api/logs/999999/photos` with one image returns 404 **and** the `photos` directory has the same file count before and after. (Hint: check existence before multer runs, or `fs.rm` every `req.files` entry on the 404 path at `:525-527`.)

## Exercise 8 — guard the keyboard double-submit

`CookLogEditor` disables the Save button while saving, but the `⌘Enter` handler calls `save()` unconditionally (`src/pages/CookLogEditor.tsx:128`). On a new log, `savedId` is only set after the first POST resolves (`:71-73`).

**Goal:** make a second `⌘Enter` during an in-flight save a no-op.
**Check:** with network throttling set to *Slow 3G*, pressing `⌘Enter` twice quickly on a new cook log produces exactly one `POST /api/recipes/:id/logs` in the Network panel and one new card in the feed.

## Exercise 9 — ownership and authorisation (stretch)

Dishes have no owner. Add one and enforce it at the `h()` boundary.

1. In `server/schema.sql`, add `owner TEXT NOT NULL DEFAULT 'anonymous'` to `dishes`. (The schema uses `CREATE TABLE IF NOT EXISTS`, so an existing database needs an `ALTER TABLE` too — decide how you will migrate.)
2. In `h()`, read an `X-Actor` header; a blank actor on POST/PATCH/DELETE → 401 via a new `AuthError` mapped in `fail()`.
3. For dish and recipe writes, load the owning dish and compare `owner` with the actor; mismatch → 403 via `ForbiddenError`, before `tx()` runs.
4. `POST /api/dishes` sets `owner` from the header, ignoring the body.

**Check:** cross-owner `PATCH /api/dishes/:id` is 403 and a following GET is unchanged; cross-owner recipe edit is 403; owner edit is 200; missing header is 401; GET needs no header. Extend the test `api()` helper (`test/recipes.test.ts:30-37`) with a headers argument.

## Completion rubric

Score each 0 (cannot explain), 1 (with help) or 2 (independent): data model, control flow through `h()`, validation vs normalisation, transaction and file-lifecycle behaviour, regression-test design, and tradeoff explanation. Aim for 2 on the first five before Exercise 9.
