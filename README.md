# 🧪 Recipe Lab

A local-first cooking journal built around a three-level hierarchy:

**Dish → Recipe → Cook Log**

- A **Dish** is what you want to make — *Pizza*, *Ramen*, *Chocolate chip cookies*. It's a container.
- A **Recipe** is one specific approach to that dish — *Neapolitan 65% hydration*, *Cast-iron pan pizza*. A dish has many recipes. Each has ingredients, steps, a source, and a verdict (keeper / needs work / abandoned / untested).
- A **Cook Log** is a single time you actually made that recipe. A recipe has many cook logs. This is the point of the app: the same recipe goes differently on different nights, and the log captures *why*.

This is a lab notebook, not Pinterest — dense, readable, keyboard-friendly, and fast to log a cook with messy hands.

## Why the cook log isn't a "review"

The tempting shortcut is to collapse cook logs into star ratings on the recipe. Recipe Lab deliberately doesn't. Each cook log keeps four things distinct:

- **What I changed** — the deltas from the base recipe (*"bread flour instead of 00 · fermented 72h"*). This is the headline of every entry.
- **Taste notes** and **process notes** — kept in separate fields, because bland dough and torn dough are unrelated problems.
- **Structured ratings** — taste, texture, effort, and would-make-again, each rated on its own axis.
- **Next time I should…** — one concrete change to try.

The result is the difference between *"this recipe is 4 stars"* and *"this recipe is 4 stars **when you cold-ferment it**."* The recipe page surfaces the single best cook and what made it best.

## Stack

- **Frontend** — React 18 + Vite + TypeScript, React Router. No component library; a small hand-rolled design system with light/dark themes.
- **Backend** — Express + Node's built-in `node:sqlite` (no native compilation). Full-text search via SQLite **FTS5**.
- **Storage** — a single SQLite file plus an uploaded-photos folder, both under `data/` (git-ignored). Fully local; no accounts, no network.

## Features

- Three-level navigation: home (dishes) → dish (recipes side by side with average ratings + verdicts) → recipe (full text + reverse-chronological cook-log feed).
- **Full-text search** across dishes, recipes, ingredients, steps, and every cook-log note. `⌘K` / `Ctrl-K` from anywhere; arrow keys + Enter to navigate hits.
- **Tags** on dishes and recipes, with filtering and autocomplete.
- **Ingredient scaling** — quantities parse human input (`1½`, `3/4`) and render back to kitchen-legible fractions when scaled.
- **Photos** on cook logs, with a lightbox.
- Keyboard-friendly editors (`⌘Enter` to save), sticky stats rail, responsive down to phone width.

## Getting started

```bash
npm install
npm run seed     # optional: populate a realistic demo journal
npm run dev      # web on http://localhost:5273, API on :5274
```

Open **http://localhost:5273**.

### Other scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server + API with watch reload |
| `npm run seed` | Wipe and repopulate the database with demo data |
| `npm run build` | Production build of the web bundle into `dist/web` |
| `npm start` | Serve the built app + API from a single Express process |
| `npm run typecheck` | `tsc --noEmit` across client, server, and shared code |

## Data model

```
dishes ──< recipes ──< cook_logs ──< photos
              │
              ├──< ingredients   (structured qty/unit/item, for scaling)
              └──< steps
tags ──< dish_tags / recipe_tags
search_index (FTS5, rebuilt on every write)
```

Deleting a dish cascades to its recipes, their cook logs, and photos (rows via `ON DELETE CASCADE`, photo files and search rows swept explicitly).

## Out of scope for v1

Meal planning, grocery lists, nutrition data, multi-user accounts, sharing.
