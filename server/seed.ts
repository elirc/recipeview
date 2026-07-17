/**
 * Seed the database with a realistic journal. Idempotent-ish: it wipes and
 * repopulates, so running it twice is safe. Run with `npm run seed`.
 */
import { db, tx, setTags, reindexDish, reindexRecipe, reindexCookLog, rebuildAllIndexes } from './db.ts';

function wipe() {
  for (const t of ['photos', 'cook_logs', 'steps', 'ingredients', 'recipe_tags', 'dish_tags', 'recipes', 'dishes', 'tags']) {
    db.exec(`DELETE FROM ${t}`);
  }
  db.exec('DELETE FROM search_index');
  // AUTOINCREMENT never reuses ids after DELETE, so without this every re-seed
  // shifts the id space and kills any bookmarked /dish/:id URL.
  try {
    db.exec('DELETE FROM sqlite_sequence');
  } catch {
    /* table only exists once an AUTOINCREMENT insert has happened */
  }
}

function dish(name: string, notes: string, tags: string[]): number {
  const id = Number(db.prepare('INSERT INTO dishes (name, notes) VALUES (?, ?)').run(name, notes).lastInsertRowid);
  setTags('dish', id, tags);
  reindexDish(id);
  return id;
}

function recipe(
  dishId: number,
  r: {
    title: string;
    source_name?: string;
    source_url?: string;
    verdict?: string;
    yield_qty?: number;
    yield_unit?: string;
    notes?: string;
    tags?: string[];
    ingredients?: [number | null, string, string, string?, string?][]; // [qty, unit, item, note?, section?]
    steps?: string[];
  },
): number {
  const id = Number(
    db
      .prepare(
        `INSERT INTO recipes (dish_id, title, source_name, source_url, verdict, yield_qty, yield_unit, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        dishId,
        r.title,
        r.source_name ?? '',
        r.source_url ?? '',
        r.verdict ?? 'untested',
        r.yield_qty ?? 1,
        r.yield_unit ?? 'serving',
        r.notes ?? '',
      ).lastInsertRowid,
  );
  (r.ingredients ?? []).forEach(([qty, unit, item, note, section], i) => {
    db.prepare(
      'INSERT INTO ingredients (recipe_id, position, qty, unit, item, note, section) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, i, qty, unit, item, note ?? '', section ?? '');
  });
  (r.steps ?? []).forEach((text, i) => {
    db.prepare('INSERT INTO steps (recipe_id, position, text) VALUES (?, ?, ?)').run(id, i, text);
  });
  setTags('recipe', id, r.tags ?? []);
  reindexRecipe(id);
  return id;
}

function log(
  recipeId: number,
  l: {
    cooked_on: string;
    changes?: string;
    taste_notes?: string;
    process_notes?: string;
    next_time?: string;
    taste?: number;
    texture?: number;
    effort?: number;
    make_again?: string;
  },
) {
  const id = Number(
    db
      .prepare(
        `INSERT INTO cook_logs
         (recipe_id, cooked_on, changes, taste_notes, process_notes, next_time,
          rating_taste, rating_texture, rating_effort, make_again)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        recipeId,
        l.cooked_on,
        l.changes ?? '',
        l.taste_notes ?? '',
        l.process_notes ?? '',
        l.next_time ?? '',
        l.taste ?? null,
        l.texture ?? null,
        l.effort ?? null,
        l.make_again ?? null,
      ).lastInsertRowid,
  );
  reindexCookLog(id);
}

tx(() => {
  wipe();

  // ---- Pizza -------------------------------------------------------------
  const pizza = dish('Pizza', 'Chasing a blistered, tender-chewy Neapolitan crust I can pull off in a home oven.', [
    'italian',
    'project',
    'dough',
  ]);

  const neapolitan = recipe(pizza, {
    title: 'Neapolitan, 65% hydration',
    source_name: 'The Pizza Bible',
    source_url: 'https://example.com/pizza-bible',
    verdict: 'keeper',
    yield_qty: 4,
    yield_unit: 'pizza',
    notes: 'Long cold ferment is doing the heavy lifting here. Oven maxed with a steel on the top rack.',
    tags: ['sourdough-ish', 'high-heat'],
    ingredients: [
      [500, 'g', '00 flour', '', 'Dough'],
      [325, 'g', 'water', 'cold', 'Dough'],
      [10, 'g', 'salt', '', 'Dough'],
      [1, 'g', 'instant yeast', '', 'Dough'],
      [null, '', 'San Marzano tomatoes', 'hand-crushed', 'Topping'],
      [125, 'g', 'fresh mozzarella', 'torn, drained', 'Topping'],
      [null, '', 'basil', 'to finish', 'Topping'],
    ],
    steps: [
      'Mix flour, water, yeast; rest 20 min (autolyse), then work in salt.',
      'Bulk 2h at room temp, then ball and cold-ferment 24–72h.',
      'Pull dough 2h before baking. Preheat steel at max for 45 min.',
      'Stretch, top lightly, bake 4–6 min until leopard-spotted.',
    ],
  });

  // Same recipe, three very different nights — the whole point of the app.
  log(neapolitan, {
    cooked_on: '2026-05-02',
    changes: 'First attempt. Straight to bake after only 24h ferment.',
    taste_notes: 'Fine but flat — flour tasted raw, not much depth.',
    process_notes: 'Dough fought the stretch and snapped back. Tore a hole launching it.',
    next_time: 'Ferment longer and let the dough warm up fully before stretching.',
    taste: 3,
    texture: 2,
    effort: 4,
    make_again: 'maybe',
  });
  log(neapolitan, {
    cooked_on: '2026-05-19',
    changes: 'Cold-fermented 72h instead of 24h. Pulled dough 2.5h before baking.',
    taste_notes: 'Night and day. Real fermented tang, wheat actually tastes sweet.',
    process_notes: 'Stretched like a dream, no tearing. Bottom set before the top browned though.',
    next_time: 'Move steel one rack higher to even out top/bottom.',
    taste: 5,
    texture: 4,
    effort: 3,
    make_again: 'yes',
  });
  log(neapolitan, {
    cooked_on: '2026-06-14',
    changes: '72h ferment + steel on the top rack under the broiler.',
    taste_notes: 'Best yet. Deep flavor, proper leopard spotting.',
    process_notes: 'Even bake top and bottom. Cornicione puffed way up.',
    next_time: 'Weigh the dough balls — the big one was underdone in the middle.',
    taste: 5,
    texture: 5,
    effort: 3,
    make_again: 'yes',
  });

  const panPizza = recipe(pizza, {
    title: 'Cast-iron pan pizza',
    source_name: 'Kenji / Serious Eats',
    source_url: 'https://www.seriouseats.com',
    verdict: 'needs-work',
    yield_qty: 1,
    yield_unit: 'pan',
    notes: 'Weeknight move — no stretching skill required, fried cheese-crust edge.',
    tags: ['weeknight', 'easy'],
    ingredients: [
      [200, 'g', 'bread flour'],
      [130, 'g', 'water'],
      [5, 'g', 'salt'],
      [2, 'g', 'instant yeast'],
      [2, 'tbsp', 'olive oil', 'for the pan'],
      [null, '', 'low-moisture mozzarella', 'to the edges'],
    ],
    steps: [
      'Mix everything but the pan oil; ferment in the fridge overnight.',
      'Press into an oiled 10" cast iron. Proof 2h until pillowy.',
      'Top, pushing cheese to the very edge. Bake at 500°F ~15 min.',
      'Finish on the stovetop 2 min to crisp the bottom.',
    ],
  });
  log(panPizza, {
    cooked_on: '2026-06-28',
    changes: 'Base recipe, no changes.',
    taste_notes: 'Cheese edge is addictive. Crumb a touch bready.',
    process_notes: 'Bottom needed the extra stovetop minute to crisp.',
    next_time: 'Try a hotter oven or a preheated pan.',
    taste: 4,
    texture: 3,
    effort: 2,
    make_again: 'yes',
  });

  // ---- Chocolate chip cookies -------------------------------------------
  const cookies = dish('Chocolate chip cookies', 'The eternal quest: crisp edge, chewy middle, deep toffee flavor.', [
    'baking',
    'dessert',
  ]);
  const browned = recipe(cookies, {
    title: 'Brown-butter, overnight rest',
    source_name: 'NYT Cooking',
    verdict: 'keeper',
    yield_qty: 18,
    yield_unit: 'cookie',
    notes: 'Resting the dough overnight is non-negotiable — hydrates the flour, deepens flavor.',
    tags: ['brown-butter'],
    ingredients: [
      [230, 'g', 'butter', 'browned, cooled'],
      [200, 'g', 'brown sugar'],
      [100, 'g', 'white sugar'],
      [2, '', 'eggs'],
      [300, 'g', 'bread flour'],
      [1, 'tsp', 'baking soda'],
      [8, 'g', 'salt', 'flaky, plus more to finish'],
      [340, 'g', 'dark chocolate', 'chopped'],
    ],
    steps: [
      'Brown the butter, cool to room temp.',
      'Cream with sugars; beat in eggs.',
      'Fold in dry ingredients, then chocolate.',
      'Rest dough 24–36h in the fridge.',
      'Bake at 375°F 11–13 min, rap the pan halfway for ripples.',
    ],
  });
  log(browned, {
    cooked_on: '2026-04-10',
    changes: 'Rested only 2 hours (impatient).',
    taste_notes: 'Good but one-note sweet, no toffee depth yet.',
    process_notes: 'Spread thin and greasy — butter too warm going in.',
    next_time: 'Actually wait overnight. Chill scooped balls.',
    taste: 3,
    texture: 3,
    effort: 2,
    make_again: 'maybe',
  });
  log(browned, {
    cooked_on: '2026-04-27',
    changes: 'Full 36h rest. Scooped and chilled, finished with flaky salt.',
    taste_notes: 'Toffee city. The rest completely transforms it.',
    process_notes: 'Perfect ripple, crisp edge, molten center.',
    next_time: 'Nothing. This is the one.',
    taste: 5,
    texture: 5,
    effort: 2,
    make_again: 'yes',
  });

  // ---- Ramen (untested recipe, for the "no cooks yet" state) -------------
  const ramen = dish('Ramen', 'Long-term project: a real tonkotsu without a restaurant kitchen.', ['japanese', 'project']);
  recipe(ramen, {
    title: 'Weeknight shortcut shoyu',
    source_name: 'Way of Ramen',
    verdict: 'untested',
    yield_qty: 2,
    yield_unit: 'bowl',
    notes: 'Bookmarked to try — dashi + chicken stock shortcut, no 18h bone broth.',
    tags: ['weeknight'],
    ingredients: [
      [500, 'ml', 'chicken stock'],
      [200, 'ml', 'dashi'],
      [3, 'tbsp', 'shoyu tare'],
      [2, 'portion', 'fresh ramen noodles'],
    ],
    steps: ['Warm stock and dashi.', 'Season bowls with tare.', 'Cook noodles, assemble with toppings.'],
  });
});

rebuildAllIndexes();

const counts = {
  dishes: (db.prepare('SELECT COUNT(*) c FROM dishes').get() as any).c,
  recipes: (db.prepare('SELECT COUNT(*) c FROM recipes').get() as any).c,
  logs: (db.prepare('SELECT COUNT(*) c FROM cook_logs').get() as any).c,
  indexed: (db.prepare('SELECT COUNT(*) c FROM search_index').get() as any).c,
};
console.log('Seeded:', counts);
