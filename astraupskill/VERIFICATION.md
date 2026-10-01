# Verification: Recipeview: validate a nested edit before replacing children

[Course index](README.md)

Verified September 8, 2026 in isolated working copies before application to the original folder.

| Check | Result |
|---|---|
| build | Passed |
| tests | Passed |
| typecheck | Passed |
| Chromium interaction | Passed |

Automated test cases: **3** delivered by Astra, plus **1** added in the fix pass (write-path id rules and search-index preservation), for 4 in `test/recipes.test.ts`.

## Tested behavior

Create Pasta with a Weeknight recipe, one ingredient and one step. PATCH only title: both child lists remain. Send title Changed with a negative ingredient quantity: return 400 and preserve parent, children and search data. Deleting the dish cascades its recipes and removes their search entries.

The course contains additional hand-worked examples and optional exercises. These are not counted as implemented tests.

## Environment and scope

Node 22.16.0 and dependencies installed in the isolated verification workspace were used. The exact dependency versions are recorded with the batch evidence. Floating dependency declarations remain floating; a clean dependency install was not repeated in every original folder.

Chromium used the actual built client and actual isolated Express server. A local verification proxy forwarded API requests and adjusted CORS for its temporary origin; it did not fabricate API responses. Data used temporary SQLite storage.

The browser screenshot was also captured at a 390px viewport. Measured document width: 390px. This is a layout smoke check, not a complete accessibility or device audit.

## Reproduce

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

Reading the diff: the files Astra touched were re-saved with CRLF line endings and Prettier formatting, so a plain `diff` shows whole files as changed. Compare with `git diff -w`, or `diff -r --strip-trailing-cr -w <backup> <project>` against the pre-change backup, to see only the real edits.

## Limits

A quantity is a number or a deliberate blank, not an arbitrary object coerced to zero. The browser parses kitchen fractions before sending JSON. The API validates nonnegative ingredient quantities and positive recipe yield. Canonical positive integer IDs reject strings such as 1e2 rather than interpreting them as another record. This remains a local personal recipe app without multi-user authorization.

These are focused learning improvements, not a production-readiness certification. Existing integrations and all optional exercises are outside the checked boundary unless named above.

Delivery hashes and local course links are checked after applying the files. Logs, screenshots, diffs and backups are in AstraOrganized2/astrafinalplan/implementation/batch04. The combined report is AstraOrganized2/astrdocs/ALL_75_PROJECTS_REPORT.md.

Note on error messages: non-`InputError` failures are answered as a generic 500 `Request failed`; the underlying error is printed by `fail()` in `server/index.ts` on the server terminal. Read the terminal when a test or the UI reports `Request failed`.
