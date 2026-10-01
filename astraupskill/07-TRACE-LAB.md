# Trace lab: Recipeview: validate a nested edit before replacing children

[Course index](README.md) · [Worked change](03-WORKED-CHANGE.md) · [Tests](04-TESTING-AND-DEBUGGING.md)

## Run it before you trace it

The first executable example from chapter 03, so the trace starts from a request you have actually sent:

```typescript
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
let server: any,
  db: any,
  origin: string,
  directory: string,
  dish: number,
  recipe: number;
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "astra-recipe-test-"));
  process.env.RECIPE_LAB_DATA = directory;
  db = (await import("../server/db.ts")).db;
  const { app } = await import("../server/index.ts");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  origin = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  if (server)
    await new Promise<void>((r) => {
      server.close(() => r());
      server.closeAllConnections();
    });
  db?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch(origin + "/api" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: r.status === 204 ? null : await r.json() };
}
test("nested recipe create and partial edit preserve ingredients and steps", async () => {
  let r = await api("/dishes", "POST", { name: "Pasta" });
  assert.equal(r.status, 201);
  dish = r.data.id;
  r = await api(`/dishes/${dish}/recipes`, "POST", {
    title: "Weeknight",
    yield_qty: 2,
    ingredients: [{ item: "Pasta", qty: 100, unit: "g" }],
    steps: [{ text: "Boil water" }],
  });
  assert.equal(r.status, 201);
  recipe = r.data.id;
  r = await api(`/recipes/${recipe}`, "PATCH", { title: "Renamed" });
  assert.equal(r.status, 200);
  assert.equal(r.data.ingredients[0].item, "Pasta");
  assert.equal(r.data.steps[0].text, "Boil water");
});
test("invalid nested edits leave parent, children and search entries unchanged", async () => {
  const before = (await api(`/recipes/${recipe}`)).data;
  for (const body of [
    { title: "", ingredients: [] },
    { title: "Changed", ingredients: [{ item: "Pasta", qty: -2 }] },
    { steps: [null] },
    { tags: [{}] },
    { yield_qty: 0 },
  ])
    assert.equal((await api(`/recipes/${recipe}`, "PATCH", body)).status, 400);
  assert.deepEqual((await api(`/recipes/${recipe}`)).data, before);
  assert.equal((await api("/recipes/1e2")).status, 400);
});
test("deleting a dish cascades recipes and removes search entries", async () => {
  assert.equal((await api(`/dishes/${dish}`, "DELETE")).status, 204);
  assert.equal((await api(`/recipes/${recipe}`)).status, 404);
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS n FROM search_index WHERE (kind='dish' AND ref_id=?) OR (kind='recipe' AND ref_id=?)",
      )
      .get(dish, recipe).n,
    0,
  );
});

test("id canonicalisation applies to write paths, and a rejected rename leaves the search index alone", async () => {
  for (const bad of ["1e2", "-1", "abc", "1.5"])
    assert.equal((await api(`/recipes/${bad}`, "PATCH", { title: "x" })).status, 400, bad);
  // Test 3 deleted the shared dish; this test owns its own fixture.
  const own = (await api("/dishes", "POST", { name: "Canonical" })).data.id;
  const before = db.prepare("SELECT title FROM search_index WHERE kind = 'dish' AND ref_id = ?").get(own);
  assert.ok(before, "search row exists for the new dish");
  assert.equal((await api(`/dishes/${own}`, "PATCH", { name: 5 })).status, 400);
  assert.deepEqual(db.prepare("SELECT title FROM search_index WHERE kind = 'dish' AND ref_id = ?").get(own), before);
  const padded = await api(`/dishes/0${own}`, "PATCH", { notes: "padded id still resolves to the same row" });
  assert.equal(padded.status, 200);
  assert.equal(padded.data.id, own);
});
```

Watch the server log while it runs, then follow the boundaries below with that exact request in mind.

## The concrete case

This lab connects one visible action to the code that accepts or rejects it. Use a disposable dataset and write your prediction before running the operation. The goal is to explain what each boundary contributes, not to memorize a sequence of clicks.

Create Pasta with a Weeknight recipe, one ingredient and one step. PATCH only title: both child lists remain. Send title Changed with a negative ingredient quantity: return 400 and preserve parent, children and search data. Deleting the dish cascades its recipes and removes their search entries.

## Write the record before touching the form

Dishes own recipes. Recipes own ordered ingredients, steps and cook logs; logs can own photos. Tags and the search_index support discovery. SQLite stores relationships; photo files live separately under RECIPE_LAB_DATA/photos.

Make a small table in your own notes with these columns: field, starting value, proposed value, and source of truth. Include identity even when the form does not display it. Include related rows or stored counters when the operation changes more than one fact. Mark a value as derived if the app recomputes it rather than storing it independently.

For example, an edit can change a title while preserving an ID. A status command can keep the same status while producing no new history. An import can contain many rows yet be rejected before any replacement begins. In each case, the meaningful observation is the promised resulting state. A success toast alone cannot establish which fields changed.

## Trace the real call path

### Boundary 1 — the editor decides what to send

`src/pages/RecipeEditor.tsx` and `DishEditor.tsx` build the payload from local form state (ingredient rows as strings, scaled quantities as numbers) and call `api.updateRecipe` / `api.updateDish` from `src/api.ts`. Quantities are parsed on the client (`shared/quantity.ts`, fractions allowed) before they are sent, but the server re-validates every row; the editor never assumes its parse is final.

### Boundary 2 — the request leaves the browser

`src/api.ts`: `updateDish(id, body)` is `PATCH /api/dishes/:id` (line 45), recipes likewise; the shared `req()` helper sets the JSON header and throws the server's `error` text. Because `fail()` hides non-input errors behind `Request failed`, the client can only ever show two kinds of message: a validation message or the generic one.

### Boundary 3 — the `h()` wrapper validates ids and payloads before any handler

`server/index.ts:69` `h(fn)` runs for every route: any `req.params` key ending in `id` must match `/^\d+$/`, be a safe integer and be at least 1 (so `1e2`, `-1` and `1.5` are 400 before a query); for `POST` and `PATCH` (except photo uploads) it calls `validatePayload(req.body)` (line 600), which type-checks and bounds every field, tags and each ingredient row, throwing `InputError`. Then it calls the handler and routes any thrown or rejected error to `fail()`.

### Boundary 4 — the handler and queries apply the change

Each route handler in `server/index.ts` calls the functions in `server/queries.ts` (`updateRecipe`, `updateDish`, ...), which use prepared statements on the `node:sqlite` `DatabaseSync`. A nested recipe edit replaces the ingredient and step rows for that recipe and re-indexes; a dish rename updates `dishes` and its `search_index` row (`server/db.ts:39-51`).

### Boundary 5 — `tx()` commits the relational rows and the search index together

`server/db.ts:18` `tx(fn)` runs `BEGIN`, the synchronous body, then `COMMIT`, and `ROLLBACK` on any throw. Because `node:sqlite` is synchronous, nothing can interleave inside the body; that is why a search-index failure (exercise 3) leaves the recipe untouched. Photo files on disk are outside the transaction and have their own lifecycle.

### Boundary 6 — the response tells the client what happened

Handlers answer `res.json(...)` with the updated detail; `fail()` answers 400 `{ error }` for `InputError` and 500 `{ error: "Request failed" }` otherwise, after `console.error(e)`. The editor then re-fetches the detail page, so the ingredient list you see is the committed one.

## Predict the regression scenarios

| Scenario from the executable suite | Prediction to write before running |
|---|---|
| nested recipe create and partial edit preserve ingredients and steps | Initial records, request/input, expected result, and records that must remain unchanged. |
| invalid nested edits leave parent, children and search entries unchanged | Initial records, request/input, expected result, and records that must remain unchanged. |
| deleting a dish cascades recipes and removes search entries | Initial records, request/input, expected result, and records that must remain unchanged. |

Open the test file and identify the arrange, act and assert portions. Arrange creates the synthetic starting state. Act calls the real boundary. Assert reads the observable result. Some tests repeat a call or issue two calls together; explain why a single ordinary call would miss that defect. Tests may share a deliberate fixture within one suite, so read setup and earlier scenario state before copying one case into a standalone script.

## A successful request, described precisely

Start with a valid fixture from the test. Copy the values into your own learning notes rather than copying a personal record. State which fields are required, which may be omitted and which have a special meaning when empty. Execute the operation once. Compare the response with a fresh authoritative read, then compare the UI with that read. If the UI is still loading, wait for the actual expected condition instead of guessing a fixed delay.

Record the stable ID and one changed field. Record at least one field that must remain the same. If the operation creates a child, record the parent ID stored on the child. If it updates an aggregate, compute the expected aggregate by hand. If it restores a backup, count retained, ignored and recreated records according to this project’s documented policy. These observations make a small example reusable when the implementation changes.

## A rejected request, described precisely

Now change one value to a rejected case named in the test suite. Keep everything else identical. Predict where validation fails. Run it and capture both the feedback and the authoritative state afterward. Compare the saved record, related rows and relevant counters with their pre-request values. A controlled error is useful only if the application also preserves the intended state.

Do not assume that all failures have the same status or message. Invalid input, missing records, conflicts and infrastructure errors represent different conditions. Read this app’s handler or parser to see the actual result. Browser-only parsers return a success/error union or throw an import error rather than returning an HTTP status. Translate the same correctness idea into the contract this app actually exposes.

## Read the storage boundary

Read server/db.ts for DatabaseSync and tx. The relational database and search index commit together, while photo files have their own lifecycle. Read test/recipes.test.ts for a temporary-database example. The delivery evidence uses Node 22.16.0; this app depends on node:sqlite.

Place a breakpoint immediately before the first write and another after the final write or publish step. On the success path, note what changed between those points. On the rejected-input path, the first write should never be reached when validation promises pre-write rejection. On a transactional failure path, some statements may execute and then roll back; reaching a write statement does not mean its effect committed.

An await marks a place where another operation can run. It does not itself define a transaction. When the test uses Promise.all, sketch request A and request B in two columns. Show where each acquires a lock or reads state. The test should accept either winner while insisting on the same final invariant. For synchronous or browser-only validation, explain why concurrency is outside the tested function rather than borrowing a database explanation that does not apply.

## Explain the design tradeoff

A recipe editor often submits a complete ingredient list, so replacing children can be easier to understand than diffing each row. That design is safe only when validation and transaction boundaries are clear. Omitting ingredients means preserve them; sending [] means intentionally remove all. Reject a malformed row before deleting the old children, so a typo does not erase an otherwise valid recipe.

Search is another representation of the same domain data. Renaming a recipe updates its searchable context through reindexRecipeTree. The SQL transaction includes the parent edit, child replacement and search-index writes. Photo files cannot participate in a SQLite transaction, so deletion collects filenames before the database cascade and removes files after commit. A file-removal failure requires separate cleanup policy.

A quantity is a number or a deliberate blank, not an arbitrary object coerced to zero. The browser parses kitchen fractions before sending JSON. The API validates nonnegative ingredient quantities and positive recipe yield. Canonical positive integer IDs reject strings such as 1e2 rather than interpreting them as another record. This remains a local personal recipe app without multi-user authorization.

## Change one requirement independently

**Practice task:** Show ingredient-row validation beside the offending row.

Before implementation, write three acceptance criteria: an ordinary successful case, a rejected or cancelled case, and a case that preserves existing behavior. Identify the smallest file boundary that owns the rule. Keep the existing regression suite; add a test only when it observes a new promise. Do not reproduce the implementation line by line inside the assertion, because both copies can contain the same mistake.

After a first attempt, compare your design with this hint: Keep the entered string and display its parse error; do not drop the row silently. Match the API domain rule after fraction parsing.

## Debug a disagreement between layers

If the form and response disagree, inspect the request payload before editing the database code. If the response and database disagree, inspect the mapper, transaction and read query. If a test fails before an HTTP request is logged, inspect startup, environment variables and the test fixture. Missing dependencies, a busy port or an unavailable database are different from a failed business assertion. Preserve the first useful error and fix that cause before interpreting later cascading failures.

When a date looks wrong, distinguish a calendar label from an instant and check the serialization boundary. When an optional field will not clear, distinguish omission from an explicit empty/null value. When a list seems to lose a record, inspect filtering, sorting and pagination before assuming deletion. When history duplicates, compare desired-state commands with commands that represent a new event. These are diagnostic questions to apply to the actual fields above.

## Final independent checkpoint

Close this guide and give a five-minute walkthrough using only the application source and one test. Explain the user-visible problem, the input contract, the identity model, the write boundary, a failed operation and the remaining limitation. Then modify the worked fixture and predict the result without running it. Reopen the guide only after writing your answer.

A useful review note includes the exact command run, its result, and the boundary it covers. Keep browser interaction, simulated storage tests, real HTTP/database tests and compile checks distinct. The [verification page](VERIFICATION.md) records this delivery’s evidence. Exercises and proposed extensions in this course remain learner work; they are not counted as implemented features.
