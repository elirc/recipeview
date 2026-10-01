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
