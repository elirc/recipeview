import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  db,
  tx,
  PHOTO_DIR,
  reindexDish,
  reindexRecipe,
  reindexRecipeTree,
  reindexCookLog,
  setTags,
} from "./db.ts";
import {
  allTags,
  cookLogsFor,
  getDishDetail,
  getRecipeDetail,
  listDishes,
  search,
  type DishSort,
} from "./queries.ts";
import {
  VERDICTS,
  MAKE_AGAIN,
  type Verdict,
  type MakeAgain,
} from "../shared/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
const PORT = Number(process.env.PORT ?? 5274);

app.use(express.json({ limit: "2mb" }));

// --- helpers ---------------------------------------------------------------

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v.trim() : fallback;
const num = (v: unknown): number | null => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** Clamp a rating to 1..5, or null. Guards against hand-rolled API calls. */
const rating = (v: unknown): number | null => {
  const n = num(v);
  if (n == null) return null;
  return Math.min(5, Math.max(1, Math.round(n)));
};
const verdict = (v: unknown): Verdict =>
  VERDICTS.includes(v as Verdict) ? (v as Verdict) : "untested";
const makeAgain = (v: unknown): MakeAgain | null =>
  MAKE_AGAIN.includes(v as MakeAgain) ? (v as MakeAgain) : null;
const today = () => new Date().toISOString().slice(0, 10);
const isDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const touch = (table: "dishes" | "recipes", id: number) =>
  db
    .prepare(`UPDATE ${table} SET updated_at = datetime('now') WHERE id = ?`)
    .run(id);

/** Wrap an async/sync handler so thrown errors become a 500 instead of a hang. */
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
function fail(res: express.Response, e: unknown) {
  console.error(e);
  if (!res.headersSent)
    res
      .status(e instanceof InputError ? 400 : 500)
      .json({ error: e instanceof InputError ? e.message : "Request failed" });
}

// --- dishes ----------------------------------------------------------------

app.get(
  "/api/dishes",
  h((req, res) => {
    const tag = str(req.query.tag) || undefined;
    const sort = str(req.query.sort) as DishSort;
    res.json(listDishes({ tag, sort }));
  }),
);

app.post(
  "/api/dishes",
  h((req, res) => {
    const name = str(req.body?.name);
    if (!name) return res.status(400).json({ error: "Name is required" });
    const out = tx(() => {
      const id = Number(
        db
          .prepare("INSERT INTO dishes (name, notes) VALUES (?, ?)")
          .run(name, str(req.body?.notes)).lastInsertRowid,
      );
      setTags("dish", id, Array.isArray(req.body?.tags) ? req.body.tags : []);
      reindexDish(id);
      return id;
    });
    res.status(201).json(getDishDetail(out));
  }),
);

app.get(
  "/api/dishes/:id",
  h((req, res) => {
    const d = getDishDetail(Number(req.params.id));
    if (!d) return res.status(404).json({ error: "Dish not found" });
    res.json(d);
  }),
);

app.patch(
  "/api/dishes/:id",
  h((req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare("SELECT 1 FROM dishes WHERE id = ?").get(id)) {
      return res.status(404).json({ error: "Dish not found" });
    }
    tx(() => {
      if (req.body?.name !== undefined) {
        const name = str(req.body.name);
        if (name)
          db.prepare("UPDATE dishes SET name = ? WHERE id = ?").run(name, id);
      }
      if (req.body?.notes !== undefined) {
        db.prepare("UPDATE dishes SET notes = ? WHERE id = ?").run(
          str(req.body.notes),
          id,
        );
      }
      if (Array.isArray(req.body?.tags)) setTags("dish", id, req.body.tags);
      touch("dishes", id);
      reindexDish(id);
      // Cook-log search titles don't embed the dish name, but recipe context
      // strings resolve live, so only the dish row needs reindexing here.
    });
    res.json(getDishDetail(id));
  }),
);

/** Photo files under every cook log of these recipes — collected BEFORE the
 *  cascade deletes the rows, removed from disk only after the tx commits. */
function photoFilesForRecipes(recipeIds: number[]): string[] {
  const files: string[] = [];
  for (const rid of recipeIds) {
    for (const p of db
      .prepare(
        "SELECT p.filename FROM photos p JOIN cook_logs cl ON cl.id = p.cook_log_id WHERE cl.recipe_id = ?",
      )
      .all(rid) as any[]) {
      files.push(p.filename);
    }
  }
  return files;
}

function removePhotoFiles(filenames: string[]) {
  for (const f of filenames)
    fs.rm(path.join(PHOTO_DIR, f), { force: true }, () => {});
}

app.delete(
  "/api/dishes/:id",
  h((req, res) => {
    const id = Number(req.params.id);
    const orphans = tx(() => {
      // ON DELETE CASCADE clears recipes/logs/photo rows; the FTS table is not
      // a real FK target and photo FILES live outside the db, so both are
      // swept by hand.
      const recipeIds = (
        db.prepare("SELECT id FROM recipes WHERE dish_id = ?").all(id) as any[]
      ).map((r) => r.id);
      const files = photoFilesForRecipes(recipeIds);
      for (const rid of recipeIds) {
        for (const l of db
          .prepare("SELECT id FROM cook_logs WHERE recipe_id = ?")
          .all(rid) as any[]) {
          db.prepare(
            "DELETE FROM search_index WHERE kind = ? AND ref_id = ?",
          ).run("cook_log", l.id);
        }
        db.prepare(
          "DELETE FROM search_index WHERE kind = ? AND ref_id = ?",
        ).run("recipe", rid);
      }
      db.prepare("DELETE FROM search_index WHERE kind = ? AND ref_id = ?").run(
        "dish",
        id,
      );
      db.prepare("DELETE FROM dishes WHERE id = ?").run(id);
      return files;
    });
    removePhotoFiles(orphans);
    res.status(204).end();
  }),
);

// --- recipes ---------------------------------------------------------------

/** Replace the ingredient + step lists wholesale. Simpler than diffing, and
 *  the editor always submits the full list anyway. */
function writeRecipeChildren(recipeId: number, body: any) {
  if (Array.isArray(body?.ingredients)) {
    db.prepare("DELETE FROM ingredients WHERE recipe_id = ?").run(recipeId);
    let pos = 0;
    for (const i of body.ingredients) {
      const item = str(i?.item);
      if (!item) continue; // a blank row in the editor is not an ingredient
      db.prepare(
        "INSERT INTO ingredients (recipe_id, position, qty, unit, item, note, section) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        recipeId,
        pos++,
        num(i?.qty),
        str(i?.unit),
        item,
        str(i?.note),
        str(i?.section),
      );
    }
  }
  if (Array.isArray(body?.steps)) {
    db.prepare("DELETE FROM steps WHERE recipe_id = ?").run(recipeId);
    let pos = 0;
    for (const s of body.steps) {
      const text = typeof s === "string" ? s.trim() : str(s?.text);
      if (!text) continue;
      db.prepare(
        "INSERT INTO steps (recipe_id, position, text) VALUES (?, ?, ?)",
      ).run(recipeId, pos++, text);
    }
  }
}

app.post(
  "/api/dishes/:dishId/recipes",
  h((req, res) => {
    const dishId = Number(req.params.dishId);
    if (!db.prepare("SELECT 1 FROM dishes WHERE id = ?").get(dishId)) {
      return res.status(404).json({ error: "Dish not found" });
    }
    const title = str(req.body?.title);
    if (!title) return res.status(400).json({ error: "Title is required" });

    const id = tx(() => {
      const rid = Number(
        db
          .prepare(
            `INSERT INTO recipes (dish_id, title, source_name, source_url, verdict, yield_qty, yield_unit, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            dishId,
            title,
            str(req.body?.source_name),
            str(req.body?.source_url),
            verdict(req.body?.verdict),
            num(req.body?.yield_qty) ?? 1,
            str(req.body?.yield_unit) || "serving",
            str(req.body?.notes),
          ).lastInsertRowid,
      );
      writeRecipeChildren(rid, req.body);
      setTags(
        "recipe",
        rid,
        Array.isArray(req.body?.tags) ? req.body.tags : [],
      );
      reindexRecipe(rid);
      return rid;
    });
    res.status(201).json(getRecipeDetail(id));
  }),
);

app.get(
  "/api/recipes/:id",
  h((req, res) => {
    const r = getRecipeDetail(Number(req.params.id));
    if (!r) return res.status(404).json({ error: "Recipe not found" });
    res.json(r);
  }),
);

app.patch(
  "/api/recipes/:id",
  h((req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare("SELECT 1 FROM recipes WHERE id = ?").get(id)) {
      return res.status(404).json({ error: "Recipe not found" });
    }
    tx(() => {
      const b = req.body ?? {};
      const sets: string[] = [];
      const vals: any[] = [];
      const put = (col: string, v: any) => {
        sets.push(`${col} = ?`);
        vals.push(v);
      };
      if (b.title !== undefined && str(b.title)) put("title", str(b.title));
      if (b.source_name !== undefined) put("source_name", str(b.source_name));
      if (b.source_url !== undefined) put("source_url", str(b.source_url));
      if (b.verdict !== undefined) put("verdict", verdict(b.verdict));
      if (b.yield_qty !== undefined) put("yield_qty", num(b.yield_qty) ?? 1);
      if (b.yield_unit !== undefined)
        put("yield_unit", str(b.yield_unit) || "serving");
      if (b.notes !== undefined) put("notes", str(b.notes));
      if (sets.length) {
        db.prepare(
          `UPDATE recipes SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`,
        ).run(...vals, id);
      }
      writeRecipeChildren(id, b);
      if (Array.isArray(b.tags)) setTags("recipe", id, b.tags);
      // The recipe title is embedded in each cook log's search title, so a
      // rename has to cascade into the log rows.
      reindexRecipeTree(id);
    });
    res.json(getRecipeDetail(id));
  }),
);

app.delete(
  "/api/recipes/:id",
  h((req, res) => {
    const id = Number(req.params.id);
    const orphans = tx(() => {
      const files = photoFilesForRecipes([id]);
      for (const l of db
        .prepare("SELECT id FROM cook_logs WHERE recipe_id = ?")
        .all(id) as any[]) {
        db.prepare(
          "DELETE FROM search_index WHERE kind = ? AND ref_id = ?",
        ).run("cook_log", l.id);
      }
      db.prepare("DELETE FROM search_index WHERE kind = ? AND ref_id = ?").run(
        "recipe",
        id,
      );
      db.prepare("DELETE FROM recipes WHERE id = ?").run(id);
      return files;
    });
    removePhotoFiles(orphans);
    res.status(204).end();
  }),
);

// --- cook logs -------------------------------------------------------------

app.get(
  "/api/recipes/:id/logs",
  h((req, res) => res.json(cookLogsFor(Number(req.params.id)))),
);

app.post(
  "/api/recipes/:id/logs",
  h((req, res) => {
    const recipeId = Number(req.params.id);
    if (!db.prepare("SELECT 1 FROM recipes WHERE id = ?").get(recipeId)) {
      return res.status(404).json({ error: "Recipe not found" });
    }
    const b = req.body ?? {};
    const cookedOn = isDate(str(b.cooked_on)) ? str(b.cooked_on) : today();

    const id = tx(() => {
      const lid = Number(
        db
          .prepare(
            `INSERT INTO cook_logs
             (recipe_id, cooked_on, changes, taste_notes, process_notes, next_time,
              rating_taste, rating_texture, rating_effort, make_again)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            recipeId,
            cookedOn,
            str(b.changes),
            str(b.taste_notes),
            str(b.process_notes),
            str(b.next_time),
            rating(b.rating_taste),
            rating(b.rating_texture),
            rating(b.rating_effort),
            makeAgain(b.make_again),
          ).lastInsertRowid,
      );
      reindexCookLog(lid);
      // Logging a cook is activity on the recipe even though no recipe column changed.
      touch("recipes", recipeId);
      return lid;
    });
    res.status(201).json(cookLogsFor(recipeId).find((l) => l.id === id));
  }),
);

app.patch(
  "/api/logs/:id",
  h((req, res) => {
    const id = Number(req.params.id);
    const existing = db
      .prepare("SELECT * FROM cook_logs WHERE id = ?")
      .get(id) as any;
    if (!existing) return res.status(404).json({ error: "Cook log not found" });

    tx(() => {
      const b = req.body ?? {};
      const sets: string[] = [];
      const vals: any[] = [];
      const put = (col: string, v: any) => {
        sets.push(`${col} = ?`);
        vals.push(v);
      };
      if (b.cooked_on !== undefined && isDate(str(b.cooked_on)))
        put("cooked_on", str(b.cooked_on));
      for (const f of [
        "changes",
        "taste_notes",
        "process_notes",
        "next_time",
      ] as const) {
        if (b[f] !== undefined) put(f, str(b[f]));
      }
      for (const f of [
        "rating_taste",
        "rating_texture",
        "rating_effort",
      ] as const) {
        if (b[f] !== undefined) put(f, rating(b[f]));
      }
      if (b.make_again !== undefined)
        put("make_again", makeAgain(b.make_again));
      if (sets.length) {
        db.prepare(
          `UPDATE cook_logs SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`,
        ).run(...vals, id);
      }
      reindexCookLog(id);
    });
    res.json(cookLogsFor(existing.recipe_id).find((l) => l.id === id));
  }),
);

app.delete(
  "/api/logs/:id",
  h((req, res) => {
    const id = Number(req.params.id);
    tx(() => {
      // Photo rows cascade, but the files on disk won't remove themselves.
      for (const p of db
        .prepare("SELECT filename FROM photos WHERE cook_log_id = ?")
        .all(id) as any[]) {
        fs.rm(path.join(PHOTO_DIR, p.filename), { force: true }, () => {});
      }
      db.prepare("DELETE FROM search_index WHERE kind = ? AND ref_id = ?").run(
        "cook_log",
        id,
      );
      db.prepare("DELETE FROM cook_logs WHERE id = ?").run(id);
    });
    res.status(204).end();
  }),
);

// --- photos ----------------------------------------------------------------

const ALLOWED_IMAGE = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
]);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PHOTO_DIR),
    filename: (_req, file, cb) => {
      // Random name: sidesteps collisions and any path games in the client filename.
      const ext = (path.extname(file.originalname) || ".jpg")
        .toLowerCase()
        .replace(/[^.a-z0-9]/g, "");
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 12 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_IMAGE.has(file.mimetype)),
});

app.post(
  "/api/logs/:id/photos",
  upload.array("photos", 12),
  h((req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare("SELECT 1 FROM cook_logs WHERE id = ?").get(id)) {
      return res.status(404).json({ error: "Cook log not found" });
    }
    const files = (req.files ?? []) as Express.Multer.File[];
    tx(() => {
      const start =
        ((
          db
            .prepare(
              "SELECT MAX(position) AS m FROM photos WHERE cook_log_id = ?",
            )
            .get(id) as any
        )?.m ?? -1) + 1;
      files.forEach((f, i) => {
        db.prepare(
          "INSERT INTO photos (cook_log_id, filename, position) VALUES (?, ?, ?)",
        ).run(id, f.filename, start + i);
      });
    });
    res
      .status(201)
      .json(
        db
          .prepare(
            "SELECT * FROM photos WHERE cook_log_id = ? ORDER BY position",
          )
          .all(id),
      );
  }),
);

app.delete(
  "/api/photos/:id",
  h((req, res) => {
    const id = Number(req.params.id);
    const p = db.prepare("SELECT * FROM photos WHERE id = ?").get(id) as any;
    if (!p) return res.status(404).json({ error: "Photo not found" });
    db.prepare("DELETE FROM photos WHERE id = ?").run(id);
    fs.rm(path.join(PHOTO_DIR, p.filename), { force: true }, () => {});
    res.status(204).end();
  }),
);

app.use(
  "/photos",
  express.static(PHOTO_DIR, { maxAge: "1y", immutable: true }),
);

// --- search & tags ---------------------------------------------------------

app.get(
  "/api/search",
  h((req, res) => res.json(search(str(req.query.q)))),
);

app.get(
  "/api/tags",
  h((_req, res) => res.json(allTags())),
);

// --- static (production) ---------------------------------------------------

const webDist = path.resolve(__dirname, "..", "dist", "web");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  // Client-side routing: anything not under /api or /photos falls back to index.
  app.get(/^(?!\/api|\/photos).*/, (_req, res) =>
    res.sendFile(path.join(webDist, "index.html")),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  app.listen(PORT, () => {
    console.log(`  Recipe Lab API  →  http://localhost:${PORT}`);
  });

class InputError extends Error {}
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
  if (
    b.tags !== undefined &&
    (!Array.isArray(b.tags) ||
      b.tags.length > 50 ||
      b.tags.some((t) => typeof t !== "string" || t.length > 100))
  )
    throw new InputError("Tags must be at most 50 short strings");
  if (
    b.yield_qty !== undefined &&
    (typeof b.yield_qty !== "number" ||
      !Number.isFinite(b.yield_qty) ||
      b.yield_qty <= 0)
  )
    throw new InputError("Yield must be a positive number");
  if (b.ingredients !== undefined) {
    if (!Array.isArray(b.ingredients) || b.ingredients.length > 300)
      throw new InputError("Ingredients must be an array of at most 300 rows");
    for (const row of b.ingredients) {
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new InputError("Invalid ingredient row");
      for (const key of ["item", "unit", "note", "section"])
        if (row[key] !== undefined && typeof row[key] !== "string")
          throw new InputError(`Ingredient ${key} must be text`);
      if (
        row.qty !== undefined &&
        row.qty !== null &&
        row.qty !== "" &&
        (typeof row.qty !== "number" ||
          !Number.isFinite(row.qty) ||
          row.qty < 0)
      )
        throw new InputError(
          "Ingredient quantity must be nonnegative or blank",
        );
    }
  }
  if (
    b.steps !== undefined &&
    (!Array.isArray(b.steps) ||
      b.steps.length > 300 ||
      b.steps.some(
        (row) =>
          typeof row !== "string" && (!row || typeof row.text !== "string"),
      ))
  )
    throw new InputError("Steps must contain text");
}
