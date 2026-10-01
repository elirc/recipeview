# Testing and debugging

[Course index](README.md)

## Run the checks

Use Node.js 22.16 or newer compatible with node:sqlite, and npm. From this project root:

```powershell
npm install
npm run dev
```

Open the Vite URL printed by the project. The API uses SQLite and creates its data directory when started; no PostgreSQL server is needed. RECIPE_LAB_DATA can point to a separate learning directory if you want another dataset. Keep the API and client running.

```powershell
npm test
npm run build
```

The regression suite assigns RECIPE_LAB_DATA to a fresh temporary directory before importing the database, runs the actual Express API through HTTP and removes only that temporary directory after closing SQLite. Existing recipe databases and photos are not fixtures.

Read server/db.ts for DatabaseSync and tx. The relational database and search index commit together, while photo files have their own lifecycle. Read test/recipes.test.ts for a temporary-database example. The delivery evidence uses Node 22.16.0; this app depends on node:sqlite.
## What the test suite proves

Read [test/recipes.test.ts](../test/recipes.test.ts). The suite targets **parent-child CRUD, partial edits and SQLite transactions** and uses the worked fixture:

Create Pasta with a Weeknight recipe, one ingredient and one step. PATCH only title: both child lists remain. Send title Changed with a negative ingredient quantity: return 400 and preserve parent, children and search data. Deleting the dish cascades its recipes and removes their search entries.

The expectation should not be copied from the function being tested. Hand-calculate counts, amounts, identities or elapsed time first. Otherwise the same mistake can appear in both implementation and expected result. Tests that exercise only a mocked dependency prove a narrower contract than tests against the real dependency; read the helper to understand which kind you are running.

This project runs its real Express app through HTTP against a fresh SQLite database in a temporary directory (`RECIPE_LAB_DATA` is set before `server/db.ts` is imported, because the module opens the database at load time). The suite removes only that directory afterwards. Browser checks exercise the built client separately; read the project verification page for the exact observed checks and limits.

## Debugging workflow

1. Reproduce the smallest failing case with the exact input saved in your notes.
2. Inspect the relevant event/request. Confirm the intended handler actually ran.
3. Pause at `validatePayload` and inspect input types as well as values.
4. Follow validation branches, noting whether any state or persistence changed before rejection.
5. Inspect the write result and the subsequent render/response. Separate storage correctness from display correctness.
6. Add a regression reproducing the failure, make the smallest justified fix, then run the focused suite and relevant broader checks.

Avoid changing several layers at once when you do not yet know where the failure starts. A correct backend with a stale UI needs a different fix from a malformed query or an invalid saved document.

## Failure experiments

- Reuse the invalid fixture from the tests and verify no unintended records or fields change.
- Reload or restart after a successful operation to distinguish persistence from temporary screen state.
- Repeat the operation and explain whether it should be idempotent, rejected or intentionally create another record.
- Simulate the relevant timing or storage failure only in a disposable fixture. Restore normal behavior after the experiment.

## Reading an assertion failure

“Expected 3, received 4” is evidence about one observation, not a complete diagnosis. Ask whether the fixture created an extra record, the operation ran twice, an old record survived, or the assertion looked at an unfiltered collection. Start from the state table and trace the first point where the actual value diverges. A stack trace identifies where the program noticed a problem, which may be later than the code that caused it.

## Verification record

The companion [VERIFICATION.md](VERIFICATION.md) records checks actually run for this implementation. Record your own command, date, result and any environmental prerequisite when practicing. A passing test does not imply every route, browser, dependency version or production deployment has been exercised.
