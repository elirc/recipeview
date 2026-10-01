# Concepts explained from first principles

[Course index](README.md)

## The central idea: parent-child CRUD, partial edits and SQLite transactions

A recipe editor often submits a complete ingredient list, so replacing children can be easier to understand than diffing each row. That design is safe only when validation and transaction boundaries are clear. Omitting ingredients means preserve them; sending [] means intentionally remove all. Reject a malformed row before deleting the old children, so a typo does not erase an otherwise valid recipe.

Search is another representation of the same domain data. Renaming a recipe updates its searchable context through reindexRecipeTree. The SQL transaction includes the parent edit, child replacement and search-index writes. Photo files cannot participate in a SQLite transaction, so deletion collects filenames before the database cascade and removes files after commit. A file-removal failure requires separate cleanup policy.

A quantity is a number or a deliberate blank, not an arbitrary object coerced to zero. The browser parses kitchen fractions before sending JSON. The API validates nonnegative ingredient quantities and positive recipe yield. Canonical positive integer IDs reject strings such as 1e2 rather than interpreting them as another record. This remains a local personal recipe app without multi-user authorization.

## Invariants: a precise way to describe correctness

An invariant is a rule that must remain true before and after an operation. “The app works” is too broad to test. “A failed import writes no records” or “editing preserves the record id” gives you something observable. For this project, derive your invariants from this behavior:

> A shared request boundary rejects malformed nested values and noncanonical IDs before handlers mutate rows. Recipe edits retain omitted children; valid replacements and search reindexing remain transactional. The app can be imported without binding a development port.

Turn each sentence into a small state table. The columns are initial state, input, expected final state and expected feedback. Include one rejected input and one retry/repeated action where relevant. A useful invariant should be meaningful even if the implementation changes from an array to a database or from one UI component to another.

## Validation versus normalization

Validation rejects values the operation cannot accept. Normalization converts acceptable values to the representation the rest of the program expects. Trimming a comparison string is normalization; rejecting an empty required field is validation. Neither operation should silently invent facts. If a quantity is free-form text, do not guess a numerical interpretation. If an imported record is malformed, do not quietly save only the convenient subset unless that is the explicit product policy.

Apply this distinction to the data model:

Dishes own recipes. Recipes own ordered ingredients, steps and cook logs; logs can own photos. Tags and the search_index support discovery. SQLite stores relationships; photo files live separately under RECIPE_LAB_DATA/photos.

Which fields can be omitted? Which can be empty? Which have a bounded vocabulary? Which have stable identity? Write those answers down before adding another conditional. A schema is simply an explicit description of that expected shape and meaning.

## State transitions and failure boundaries

Every change has an ordering. If memory changes first and persistence fails, the UI can show data that will disappear after reload. If persistence succeeds first and rendering fails, the stored data may be correct while the screen is stale. There is no universal answer for every feature, but the choice must be deliberate and observable. The worked change makes one specific promise; the tests check that promise.

A promise represents an operation that completes later. `await` does not make it infallible or atomic; it gives the caller a place to handle success and rejection. Similarly, calling several functions inside one `try` block does not create a database transaction. Atomicity must come from a storage operation or transaction boundary that actually provides it.

## Identity, representation and derived values

Keep a stable id when updating an existing record. Compute display-only values from authoritative data when feasible, so there are fewer independently mutable facts to keep synchronized. Be careful when converting between strings and numbers: `Number('')` is zero, JSON cannot faithfully represent Infinity, and a date string can have different semantics from a timestamp. The specific conversions in this lesson are visible in the worked source, so step through them with a concrete value.

## Small design decisions deserve explanations

Before extracting a new abstraction, explain what repeated responsibility it would own. A helper that merely renames one expression may add little. A pure validator or one transaction boundary can make an important guarantee easier to test. Prefer an explanation tied to this project’s behavior over a rule such as “all code must use a particular pattern.”

Write a short decision note: “We chose X because it preserves Y under Z. It does not yet solve W.” Use the limitations in the worked example to fill in those letters. This is the beginning of engineering judgment: choosing a bounded solution and accurately describing its limits.
