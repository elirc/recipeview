# Worked implementation and examples

[Course index](README.md)

## Before and after

**Before:** Nested recipe payloads could contain malformed ingredient/step values, blank edits were silently ignored, and IDs/dates were accepted by loose conversions.

**After:** A shared request boundary rejects malformed nested values and noncanonical IDs before handlers mutate rows. Recipe edits retain omitted children; valid replacements and search reindexing remain transactional. The app can be imported without binding a development port.

## Predict this example

Create Pasta with a Weeknight recipe, one ingredient and one step. PATCH only title: both child lists remain. Send title Changed with a negative ingredient quantity: return 400 and preserve parent, children and search data. Deleting the dish cascades its recipes and removes their search entries.

Before running anything, write the exact expected stored values and visible response. Include ids or record counts where they matter. Then run the focused tests and reproduce the matching UI/API action. Do not settle for seeing a success message: inspect the authoritative stored result as well.

## Actual implementation excerpt

The lines below are the ones Astra changed (compare `AstraOrganized2/astrafinalplan/implementation/batch04/backups/72/server/index.ts` with `diff --strip-trailing-cr -w`): the `h()` wrapper that validates route ids and payloads for every handler, `validatePayload` as the single request-boundary validator, and `fail()` mapping `InputError` to 400 and everything else to a generic 500. The linked source is authoritative if you later edit the project.

```typescript
// server/index.ts:69
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
function fail(res: express.Response, e: unknown) {

// server/index.ts:600
function validatePayload(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new InputError("Send a JSON object");
  const b = body as Record<string, unknown>;
  for (const key of [
    "name",
    "title",
    "notes",
    "source_name",
    "source_url",
    "yield_unit",
  ]) {
    if (b[key] === undefined) continue;
    if (
      typeof b[key] !== "string" ||
      (b[key] as string).length > 20000 ||
      (["name", "title"].includes(key) && !(b[key] as string).trim())
    )
      throw new InputError(`${key} must contain valid text`);
  }
```

## The error-handling change: what the browser sees and what the terminal sees

`fail(res, e)` in `server/index.ts:94` now answers 400 with the message only for an `InputError`; every other exception becomes a generic 500 `Request failed`. The reason is to stop leaking internals (a SQLite constraint name, a file path) to the browser. The consequence for you as a debugger: when the client shows `Request failed`, the real message is in the **server terminal**, because `fail()` calls `console.error(e)` before answering. The UI cannot tell you what happened; the terminal can. Chapter 4's debugging workflow therefore starts with the terminal, not with the network panel.

## A gap the new test found: validated but not canonical

Before the fix pass, `h()` validated that an id *looked* like a positive integer and then left `req.params.id` as the raw text. SQLite compares `"01"` with the integer column and finds nothing, so a zero-padded id was a 404 even though it passed validation. The wrapper now rewrites each validated id to its canonical decimal form (`String(Number(value))`), which is what the fourth test asserts with `PATCH /api/dishes/0<id>`. The lesson: validating the shape of an input and normalizing it are two steps, and the second one is easy to forget when the first one passes.

## How to reason through the code

1. Identify the inputs. Distinguish data supplied by a caller from state read from storage or a trusted context.
2. Find the guard clauses. For each early return or thrown error, describe which invariant it protects and whether anything has already been written.
3. Find the candidate state or query. Explain whether it mutates an existing object or constructs a replacement.
4. Locate the persistence operation. For asynchronous code, follow the promise through success and rejection; for transactions, check that all related writes use the same transaction object.
5. Find the output or state publication. Ask what a repeated invocation would do after the first invocation succeeds.

Use this project-specific reasoning as your guide:

A recipe editor often submits a complete ingredient list, so replacing children can be easier to understand than diffing each row. That design is safe only when validation and transaction boundaries are clear. Omitting ingredients means preserve them; sending [] means intentionally remove all. Reject a malformed row before deleting the old children, so a typo does not erase an otherwise valid recipe.

Search is another representation of the same domain data. Renaming a recipe updates its searchable context through reindexRecipeTree. The SQL transaction includes the parent edit, child replacement and search-index writes. Photo files cannot participate in a SQLite transaction, so deletion collects filenames before the database cascade and removes files after commit. A file-removal failure requires separate cleanup policy.

A quantity is a number or a deliberate blank, not an arbitrary object coerced to zero. The browser parses kitchen fractions before sending JSON. The API validates nonnegative ingredient quantities and positive recipe yield. Canonical positive integer IDs reject strings such as 1e2 rather than interpreting them as another record. This remains a local personal recipe app without multi-user authorization.

## Three variations to work through

**Normal variation — a partial recipe edit.** `PATCH /api/recipes/:id` with only `{ "title": "Weeknight v2" }`. Predict: 200, title changed, ingredient and step counts unchanged, and the `search_index` row for that recipe carries the new title. Read `search_index` in the SQLite file with `sqlite3` or a small script.

**Invalid variation — a bad ingredient row.** `PATCH` with `{ "ingredients": [{ "item": "Salt", "quantity": -1 }] }`. Predict 400 with the `InputError` text from `validatePayload`, and the recipe's ingredients unchanged. Then send `{ "tags": "x" }`: predict the exact message (`Tags must be at most 50 short strings`).

**Boundary variation — a failure the client cannot see.** Temporarily rename the `search_index` table in a scratch copy of the data directory and edit a dish. Predict: the browser shows `Request failed`, the terminal shows the SQLite error, and the dish name is unchanged because `tx()` rolled back. Restore the table.

## Executable examples

These are the actual regression tests in [test/recipes.test.ts](../test/recipes.test.ts). Read each test as arrange → act → assert. Setup creates a controlled initial state, the action exercises the application code, and assertions compare observable behavior with an independently stated expectation.

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

## Explain it back

Give a five-minute walkthrough: the original problem, one invariant, the exact changed function, the most revealing failure test, and one remaining limitation. You should be able to explain why the implementation is correct for the worked example without reading the code aloud line by line.
