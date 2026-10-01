# Solutions and engineering review

[Course index](README.md) · [Practice prompts](05-PRACTICE.md)

Attempt each exercise before using these notes. These are solution approaches and review criteria, not claims that every extension has been implemented. The actual completed behavior is described in the worked-change chapter.

## Existing implementation

A shared request boundary rejects malformed nested values and noncanonical IDs before handlers mutate rows. Recipe edits retain omitted children; valid replacements and search reindexing remain transactional. The app can be imported without binding a development port.

The key model is: Dishes own recipes. Recipes own ordered ingredients, steps and cook logs; logs can own photos. Tags and the search_index support discovery. SQLite stores relationships; photo files live separately under RECIPE_LAB_DATA/photos.

The worked fixture should behave as follows: Create Pasta with a Weeknight recipe, one ingredient and one step. PATCH only title: both child lists remain. Send title Changed with a negative ingredient quantity: return 400 and preserve parent, children and search data. Deleting the dish cascades its recipes and removes their search entries.

## Extension solutions

### Exercise 1

**Prompt:** Show ingredient-row validation beside the offending row.

**Approach:** Keep the entered string and display its parse error; do not drop the row silently. Match the API domain rule after fraction parsing.

**Review:** the message must be attached to the row whose `quantity` failed `shared/quantity.ts` parsing, the raw string must stay in the input, and the server rule must still be the authority: a client test shows the inline message, a server test shows the same row rejected with 400 by `validatePayload` and the recipe unchanged.

### Exercise 2

**Prompt:** Add a preview of scaled ingredient quantities without saving the scale.

**Approach:** Compute quantity times desiredYield/originalYield as derived state. Keep the saved recipe unchanged until a separate edit is confirmed.

**Review:** the scaled quantities must be derived state (`quantity * desiredYield / originalYield`) rendered next to the saved values, with no `PATCH` issued while previewing; assert with a client test that `api.updateRecipe` is not called until the user confirms, and that fractions round-trip through `shared/quantity.ts` formatting.

### Exercise 3

**Prompt:** Force a search-index write failure and verify the recipe edit rolls back.

**Approach:** Use a fresh SQLite fixture and trigger failure after the parent update; assert the title and children retain their prior values.

**Review:** inject the failure inside `tx()` after the parent update (a temporary throw in the search-index insert, or a `db.exec` that drops `search_index` in the test) and assert the title, ingredients, steps and search rows all equal their pre-request values; explain which line of `server/db.ts` ran `ROLLBACK`.

### Exercise 4

**Prompt:** Design stable child IDs if ingredients gain independent history.

**Approach:** Replace wholesale deletion with explicit create/update/delete operations keyed by ingredient ID. Explain ordering independently from identity and add conflict handling for concurrent editors.

**Review:** the design must give ingredients a stable `id`, replace wholesale deletion with create/update/delete keyed by that id, keep `position` separate from identity, and describe what happens when two editors reorder concurrently (last write wins on `position`, or a version check on the recipe row).

### Exercise 7 — ownership and authorization

Reference (the check runs inside `h()` after id validation, before the handler's transaction):

```typescript
class ForbiddenError extends Error {}
class AuthError extends Error {}
// in fail(): AuthError -> 401, ForbiddenError -> 403, InputError -> 400, else 500
function requireOwner(req: express.Request, dishId: number) {
  const row = db.prepare("SELECT owner FROM dishes WHERE id = ?").get(dishId) as { owner: string } | undefined;
  if (!row) throw new InputError("Dish not found");
  if (row.owner !== (req as any).actor) throw new ForbiddenError("Only the owner can change this dish.");
}
```

Reference test skeleton: create a dish with `{ "X-Actor": "ana" }`; `PATCH` it with `{ "X-Actor": "ben" }` -> 403 and `GET` deep-equals the original; `PATCH` with `ana` -> 200; `PATCH` with no header -> 401.

Review: explain why the ownership lookup is a separate read before `tx()` here (SQLite is synchronous and single-writer, so no interleaving can change `owner` between the check and the write) and what would change with PostgreSQL.

## Review questions with answer guidance

**Why not trust input just because it came from this UI?** A caller can bypass the UI, a saved file can be edited, and older data can have a different shape. Validate at the boundary that owns the operation.

**Why keep the id stable?** It identifies the same domain record across views and edits. Changing it can create duplicates, disconnect child records or make reconciliation impossible.

**What makes the failure test meaningful?** It observes the promised state invariant. For this project, explain exactly why the failing scenario in [test/recipes.test.ts](../test/recipes.test.ts) would detect the original or a plausible regression.

**What does the test not prove?** A bounded suite does not prove all concurrency, browsers, deployment configurations or unrelated domain behavior. Name the real limitation from this lesson instead of adding a generic disclaimer.

**When should you extract a helper?** When it isolates a coherent responsibility, makes an invariant clearer or enables a meaningful test without duplicating application logic. A pure validator and a shared persistence boundary are common examples, but do not abstract solely to increase the number of files.

## A sample change explanation

“The previous behavior was: Nested recipe payloads could contain malformed ingredient/step values, blank edits were silently ignored, and IDs/dates were accepted by loose conversions. I changed the implementation so that: A shared request boundary rejects malformed nested values and noncanonical IDs before handlers mutate rows. Recipe edits retain omitted children; valid replacements and search reindexing remain transactional. The app can be imported without binding a development port. The strongest evidence is the regression that exercises the worked fixture and checks authoritative state. A remaining design question is the final stretch exercise.”

Replace that explanation with your own words and actual test results. A strong junior engineer can connect a concrete user problem to code, verification and a clearly stated limit. Completing that explanation independently is the final checkpoint for this course.
