# Recipeview: validate a nested edit before replacing children

This is a hands-on course for a junior software engineer using the actual project in `recipeview`. The central skill is **parent-child CRUD, partial edits and SQLite transactions**. The implementation is already present: use it as a worked example, then recreate a small variation independently.

## What you will be able to do

- Explain the purpose of the changed code and the data it owns.
- Trace an action from input through validation, state/persistence and output.
- Predict a success case and a failure case before running either.
- Read the regression tests and explain what each assertion proves.
- Implement a related change without copying the worked answer.
- Explain a limitation and a reasonable next step without overstating readiness.

## Prerequisites

Be comfortable with variables, arrays, objects, functions, conditionals and calling a function. For React projects, review props, state and event handlers. For API projects, review JSON, HTTP methods and promises, then learn the relevant SQL operations as you trace the request. You do not need to memorize the whole repository first.

## Start the project

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

The commands are run from this project’s folder, not from the Desktop inventory repository. Existing README/Fable material remains available. This folder teaches the implemented change and points to executable source and tests rather than replacing older guides.

### Toolchain

This course was delivered and verified on **Node 22.16.0**, **npm 10**. Use the same major versions: newer patch releases are fine, older majors are untested here.

`npm test` from the project root runs `tsx --test test/*.test.ts`. npm runs scripts through `cmd.exe` on Windows, and `cmd.exe` does not expand the `test/*.test.ts` glob; neither does PowerShell for a native command. Node's own test runner expands the pattern (Node 21+), so `npm test` works on Node 22 - but on an older Node, or with a different runner, you will see "no test files". The shell-independent equivalent is:

```powershell
npx tsx --test test/recipes.test.ts
```

## Reading and practice order

1. [Codebase map and reading order](01-CODEBASE-MAP.md)
2. [Concepts explained from first principles](02-CONCEPTS.md)
3. [Worked implementation and examples](03-WORKED-CHANGE.md)
4. [Tests, failure cases and debugging](04-TESTING-AND-DEBUGGING.md)
5. [Guided and independent exercises](05-PRACTICE.md)
6. [Solutions, tradeoffs and review rubric](06-SOLUTIONS-AND-REVIEW.md)
7. [Detailed trace lab and independent checkpoint](07-TRACE-LAB.md)
8. [Actual verification results and limits](VERIFICATION.md)

## Your first session

1. Open the app or its tests and reproduce one normal workflow.
2. Read chapter 1 while keeping [server/index.ts](../server/index.ts) open.
3. Write a prediction for the worked example in chapter 3 before executing it.
4. Run the focused test suite and explain one assertion aloud.
5. Complete the first practice exercise, then check the solution discussion.

Keep a short learning log with four fields: prediction, observed result, explanation and next question. A mismatch is useful evidence: find the exact layer where your mental model diverged from the program. Use a disposable browser profile or local test database for failure experiments so your own records are not part of the fixture.

## What each chapter gives you

| Chapter | You leave with |
| --- | --- |
| 01 | A file-by-file map of the 4-file server and a seven-step trace of a recipe rename |
| 02 | The omit/empty/replace contract for children, `tx()` semantics, FTS denormalisation, validation-vs-normalisation table |
| 03 | The current `h()` source annotated line by line, the four tests annotated, and a `qty`-vs-`quantity` trap |
| 04 | How the suite isolates itself, a table of untested code, and four failure experiments with observable Checks |
| 05 | Ten exercises, each with a Goal and an observable Check, several fixing real findings |
| 06 | Solution sketches and an eleven-row senior review with file:line references |
| 07 | A boundary-by-boundary trace using the test requests |

## Scope

A shared request boundary rejects malformed nested values and noncanonical IDs before handlers mutate rows. Recipe edits retain omitted children; valid replacements and search reindexing remain transactional. The app can be imported without binding a development port. This is one bounded improvement, not certification of every feature. Read VERIFICATION.md for checks actually executed. Exercises are intentionally future practice; do not confuse them with completed implementation.
