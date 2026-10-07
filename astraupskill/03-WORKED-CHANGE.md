# Worked implementation and examples

[Course index](README.md)

## Before and after

**Before:** Nested recipe payloads could contain malformed ingredient/step values, blank edits were silently ignored, and ids were accepted by loose conversions.

**After:** A shared request boundary rejects malformed nested values and non-canonical ids before handlers mutate rows. Recipe edits retain omitted children; valid replacements and search re-indexing remain transactional. The app can be imported without binding a development port.

## Predict this example

Create a dish *Pasta* with a recipe *Weeknight* (one ingredient, one step). PATCH only the title: both child lists remain. Send title *Changed* with a negative ingredient quantity: 400, and parent, children and search data are unchanged. Delete the dish: its recipes are gone and their search rows are removed.

Before running anything, write the expected stored values and responses, including ids and row counts. Then run the tests and reproduce one step through the UI. A success toast is not evidence; read the authoritative stored result.

## The implementation, as it is in the source today

### `h()` — the wrapper every route goes through (`server/index.ts:69-95`)

```typescript
const h =
  (fn: (req: express.Request, res: express.Response) => unknown) =>
  (req: express.Request, res: express.Response) => {
    try {
      for (const [key, value] of Object.entries(req.params)) {
        if (
          key.toLowerCase().endsWith("id") &&
          (typeof value !== "string" ||
            !/^\d+$/.test(value) ||
            !Number.isSafeInteger(Number(value)) ||
            Number(value) < 1)
        )
          throw new InputError("Use a positive whole-number id");
        // Canonicalize so handlers compare an integer, not the raw text ("01" -> "1").
        if (key.toLowerCase().endsWith("id")) req.params[key] = String(Number(value));
      }
      if (
        ["POST", "PATCH"].includes(req.method) &&
        !req.path.endsWith("/photos")
      )
        validatePayload(req.body);
      const out = fn(req, res);
      if (out instanceof Promise) out.catch((e) => fail(res, e));
    } catch (e) {
      fail(res, e);
    }
  };
```

Line by line:

- `:73-81` — the id rule. `/^\d+$/` alone would accept `"0"` and `"99999999999999999999"`; the safe-integer and `≥ 1` checks close those. `1e2` fails the regex, so it can never be read as record 100.
- `:83` — normalisation after validation. `"01"` becomes `"1"`. Without this, a handler that did `req.params.id === something` as text would disagree with SQLite.
- `:85-89` — payload validation for POST/PATCH, skipped for multipart photo uploads.
- `:90-91` — handlers are synchronous today (all `node:sqlite` calls are), but the wrapper still catches a rejected promise so a future `async` handler cannot hang the request.
- Note what `h()` does **not** do: it does not check that the record exists. Each handler does that itself (e.g. `:147-149`, `:320-322`) — and the DELETE handlers do not, so deleting a missing id returns 204.

### `validatePayload` — the single request-boundary validator (`server/index.ts:602-668`)

It checks: the body is a plain object (`:603-604`); six text keys are strings ≤ 20,000 characters, and `name`/`title` are non-blank (`:606-621`); `tags` is ≤ 50 strings of ≤ 100 chars (`:622-628`); `yield_qty` is a positive finite number (`:629-635`); `ingredients` is ≤ 300 objects whose `item/unit/note/section` are strings and whose `qty` is a non-negative number, `null`, `""` or absent (`:636-657`); `steps` is ≤ 300 strings or `{text: string}` objects (`:658-667`).

It checks **only keys it knows**. Unknown keys pass through (and are ignored by handlers). Cook-log keys (`changes`, `rating_taste`, `cooked_on`, ...) are not in its list at all.

### `fail()` — what the browser sees vs what the terminal sees (`server/index.ts:96-102`)

`fail` answers 400 with the message only for an `InputError`; every other exception becomes a generic 500 `Request failed`, after `console.error(e)`. That stops SQLite constraint names and file paths leaking to the browser. For you as a debugger: when the client shows `Request failed`, the real message is in the **server terminal**. Chapter 4's workflow starts there.

## A gap the fourth test found: validated but not canonical

Before the fix pass, `h()` validated that an id *looked* like a positive integer and left `req.params.id` as raw text. The fix is line 83. The fourth test asserts it with `PATCH /api/dishes/0<id>` returning 200 and the same id (`test/recipes.test.ts:90-92`). Lesson: validating a shape and normalising a value are two steps, and the second is easy to forget once the first passes.

## The four tests, annotated

Read [`test/recipes.test.ts`](../test/recipes.test.ts) alongside this table rather than a copy of it.

| Test (line) | Arrange | Act | Assert — and what it proves |
| --- | --- | --- | --- |
| `:38` nested create + partial edit | `POST /dishes` Pasta; `POST /dishes/:id/recipes` with 1 ingredient, 1 step | `PATCH /recipes/:id {title:"Renamed"}` | 200, `ingredients[0].item === "Pasta"`, `steps[0].text === "Boil water"` → the omitted-key branch (`index.ts:234`, `:253`) preserves children |
| `:55` invalid edits change nothing | Snapshot `GET /recipes/:id` | Five bad PATCH bodies | Each is 400; a final GET `deepEqual`s the snapshot → rejection happens before any write. Also `GET /recipes/1e2` is 400 |
| `:68` dish delete cascades | Uses the dish/recipe from test 1 | `DELETE /dishes/:id` | 204; recipe GET is 404; zero `search_index` rows for that dish or recipe → manual FTS sweep at `index.ts:205-220` works |
| `:81` canonical ids + rejected rename | Own fixture dish | Four bad ids; `PATCH {name: 5}`; `PATCH /dishes/0<id>` | 400s; the dish's search title is unchanged; padded id resolves to the same row |

Note the tests share module-level `dish`/`recipe` variables: tests 2 and 3 depend on test 1 having run, and test 4 builds its own fixture because test 3 deleted the shared one (comment at `:84`). Running test 3 alone with `--test-name-pattern` would fail for that reason.

## Three variations to work through

**Normal variation — a partial recipe edit.** `PATCH /api/recipes/:id` with only `{ "title": "Weeknight v2" }`. Expect 200, title changed, ingredient and step counts unchanged, and the recipe's `search_index` title updated — and every cook log's search title too, because of `reindexRecipeTree` (`server/db.ts:105-110`).

**Invalid variation — a bad ingredient row.** `PATCH` with `{ "ingredients": [{ "item": "Salt", "qty": -1 }] }`. Expect 400 with `Ingredient quantity must be nonnegative or blank` (`server/index.ts:653-655`) and the ingredients unchanged. Then send `{ "tags": "x" }` and expect `Tags must be at most 50 short strings` (`:628`).

> **Trap:** the field is `qty`, not `quantity`. `{ "item": "Salt", "quantity": -1 }` is **accepted** — `validatePayload` ignores unknown keys, so the request succeeds with 200 and *replaces* the recipe's ingredient list with one `Salt` row whose `qty` is `NULL`. Try it on a scratch recipe: it is a good demonstration that an allow-list validator silently ignores misspelled fields.

**Boundary variation — a failure the client cannot see.** Use a throwaway `RECIPE_LAB_DATA` directory. With the server stopped, rename `search_index` using the `sqlite3` CLI (`ALTER TABLE search_index RENAME TO si_old;`). Start the server: `schema.sql` recreates an empty `search_index` on load (`CREATE VIRTUAL TABLE IF NOT EXISTS`, `schema.sql:116`), so this alone does *not* break writes. To force a failure instead, temporarily add `throw new Error("boom")` as the last statement of `reindexDish` (after the `INSERT` that ends at `server/db.ts:52`) and edit a dish name. Expect: the browser toast shows `Request failed`, the terminal shows `Error: boom`, and the dish name is unchanged because `tx()` rolled back (`server/db.ts:24-26`). Remove the throw.

## Explain it back

Give a five-minute walkthrough: the original problem, one invariant (e.g. "a rejected PATCH writes nothing"), the function that enforces it (`validatePayload`, called at `index.ts:89` before the handler), the most revealing test (`:55`), and one remaining limitation (cook-log fields are normalised rather than validated).
