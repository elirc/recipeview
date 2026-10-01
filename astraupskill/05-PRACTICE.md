# Guided and independent practice

[Course index](README.md) · [Solutions](06-SOLUTIONS-AND-REVIEW.md)

## Exercise 0 — reconstruct the existing behavior

Draw the data shape and trace this fixture without running it:

Create Pasta with a Weeknight recipe, one ingredient and one step. PATCH only title: both child lists remain. Send title Changed with a negative ingredient quantity: return 400 and preserve parent, children and search data. Deleting the dish cascades its recipes and removes their search entries.

Write one assertion for success and one for a rejected or failed operation. Then read the existing test and compare its observation with yours. Explain why a message alone would or would not prove the invariant.

## Exercise 1 — guided extension

Show ingredient-row validation beside the offending row.

Start by locating the current input, handler and output. Write an acceptance example before editing. Make one small change, run the focused tests, and demonstrate it through the same public UI/API a user would use. Add one meaningful regression if the behavior can break in a way the existing suite would miss.

## Exercise 2 — independent variation

Add a preview of scaled ingredient quantities without saving the scale.

Close the worked-change chapter while implementing. Describe your design in three sentences: the data you will add or reuse, the rule it must preserve, and the observation that proves it. Compare your answer with the solution only after an independent attempt. If you get stuck, request a hint about the next boundary rather than a complete implementation.

## Exercise 3 — failure-focused extension

Force a search-index write failure and verify the recipe edit rolls back.

Create a failing example in a disposable fixture. Capture the state before the operation and after the failure. Identify what must remain unchanged and what feedback the caller needs. A correct result includes understandable recovery behavior, not just throwing an exception.

## Exercise 4 — stretch design

Design stable child IDs if ingredients gain independent history.

Write a short design note before coding. List the current guarantee, the stronger guarantee you want and the new failure modes the change introduces. If this requires a larger architectural change, stop at a concrete proposal and test design until you understand the prerequisite. The earlier exercises should remain understandable and runnable.

## Exercise 5 — teach the codebase

Give a five-minute walkthrough to another learner, or record yourself. Use [server/index.ts](../server/index.ts) and one test. Explain the application problem, the data model, the call path, one success case, one failure case and the tradeoff. Ask the listener to predict a new input’s result. Their questions reveal which part of your explanation needs work.

## Exercise 6 — review your own change

Inspect the diff as if you were a teammate encountering it for the first time. Remove unrelated edits. Check names, error feedback, preservation of ids/data, and the order of writes. Update the learning note if the actual code differs from the plan. Record what was tested and what remains an assumption.

## Exercise 7 — ownership and authorization

Dishes have no owner. Add one and enforce it at the `h()` boundary.

1. Migration in `server/schema.sql`: `owner TEXT NOT NULL DEFAULT 'anonymous'` on `dishes`.
2. In `server/index.ts`, read `X-Actor` in `h()` and expose it as `req.actor`; blank on `POST`, `PATCH`, `DELETE` -> 401 (a new `AuthError` mapped in `fail()`).
3. For dish and recipe writes, load the dish first and compare `owner` with `req.actor`; mismatch -> 403 through a `ForbiddenError`, before `tx()` runs. Recipes inherit their dish's owner.
4. `POST /api/dishes` sets `owner` from the header, ignoring any body value.

Acceptance, written first: cross-owner `PATCH /api/dishes/:id` is 403 and the row is unchanged; cross-owner recipe edit is 403; owner edit is 200; missing header is 401; `GET` needs no header. Extend the test `api()` helper with a headers argument.

## Completion rubric

Score each item 0 (cannot explain), 1 (can explain with help) or 2 (independent): data model, control flow, validation, persistence/failure behavior, regression test design, and tradeoff explanation. Aim for 2 on the first five before taking the stretch exercise. Revisit a weak area with a changed-input example rather than rereading every page.
