import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api';
import type { RecipeDetail, CookLog, Ingredient } from '@shared/types';
import { Empty, Spinner, VerdictBadge } from '../components/bits';
import { RecipeEditor } from './RecipeEditor';
import { CookLogEditor } from './CookLogEditor';
import { CookLogCard } from './CookLogCard';
import { Confirm } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { scaleQty, formatQty, SCALE_PRESETS } from '@shared/quantity';
import { fmt1, fmtDate, pluralize, scoreColor } from '../lib/format';
import { cookScore } from '@shared/types';

export function RecipePage() {
  const { id } = useParams();
  const recipeId = Number(id);
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [factor, setFactor] = useState(1);
  const [editRecipe, setEditRecipe] = useState(false);
  const [logging, setLogging] = useState(false);
  const [editingLog, setEditingLog] = useState<CookLog | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [delLog, setDelLog] = useState<CookLog | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([api.getRecipe(recipeId), api.tags()]);
      setRecipe(r);
      setTags(t.map((x) => x.name));
    } catch {
      setMissing(true);
    }
  }, [recipeId]);

  useEffect(() => {
    load();
  }, [load]);

  // Deep-link to a specific cook log from search (#log-42).
  useEffect(() => {
    if (recipe && loc.hash.startsWith('#log-')) {
      const el = document.getElementById(loc.hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1600);
      }
    }
  }, [recipe, loc.hash]);

  if (missing) return <Empty icon="🤷" title="Recipe not found">{<Link to="/">Back home</Link>}</Empty>;
  if (!recipe) return <Spinner />;

  const deleteRecipe = async () => {
    try {
      await api.deleteRecipe(recipeId);
      toast('Recipe deleted');
      nav(`/dish/${recipe.dish_id}`);
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };

  const removeLog = async (log: CookLog) => {
    try {
      await api.deleteLog(log.id);
      toast('Cook log deleted');
      setDelLog(null);
      load();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };

  const s = recipe.stats;
  const logs = recipe.cook_logs;

  return (
    <main className="content">
      <nav className="crumbs">
        <Link to="/">Dishes</Link>
        <span className="sep">/</span>
        <Link to={`/dish/${recipe.dish_id}`}>{recipe.dish_name}</Link>
        <span className="sep">/</span>
        <span>{recipe.title}</span>
      </nav>

      <div className="recipe-layout">
        {/* LEFT: the recipe itself */}
        <div className="recipe-main">
          <div className="recipe-header">
            <div className="row wrap" style={{ gap: 10, marginBottom: 6 }}>
              <VerdictBadge verdict={recipe.verdict} />
              {recipe.tags.map((t) => (
                <span key={t.id} className="tag">
                  {t.name}
                </span>
              ))}
            </div>
            <div className="spread" style={{ alignItems: 'flex-start' }}>
              <h1 className="page-title">{recipe.title}</h1>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn ghost sm" onClick={() => setEditRecipe(true)}>
                  Edit
                </button>
                <button className="btn danger ghost sm" onClick={() => setConfirmDel(true)}>
                  Delete
                </button>
              </div>
            </div>
            {recipe.source_name && (
              <div className="recipe-source">
                Source:{' '}
                {recipe.source_url ? (
                  <a href={recipe.source_url} target="_blank" rel="noreferrer">
                    {recipe.source_name} ↗
                  </a>
                ) : (
                  <span>{recipe.source_name}</span>
                )}
              </div>
            )}
          </div>

          {recipe.notes && <p className="recipe-notes">{recipe.notes}</p>}

          <BestLogCallout recipe={recipe} />

          {/* Ingredients + scaling */}
          {recipe.ingredients.length > 0 && (
            <section className="recipe-section">
              <div className="spread">
                <h2 className="section-title">Ingredients</h2>
                <ScaleControl recipe={recipe} factor={factor} onChange={setFactor} />
              </div>
              <IngredientList ingredients={recipe.ingredients} factor={factor} />
            </section>
          )}

          {/* Steps */}
          {recipe.steps.length > 0 && (
            <section className="recipe-section">
              <h2 className="section-title">Steps</h2>
              <ol className="steps">
                {recipe.steps.map((st) => (
                  <li key={st.id}>{st.text}</li>
                ))}
              </ol>
            </section>
          )}

          {recipe.ingredients.length === 0 && recipe.steps.length === 0 && (
            <div className="recipe-thin">
              <span className="muted">No ingredients or steps yet.</span>{' '}
              <button className="linkish" onClick={() => setEditRecipe(true)}>
                Add them
              </button>
            </div>
          )}
        </div>

        {/* RIGHT: stats rail */}
        <aside className="recipe-rail">
          <div className="rail-card card">
            <div className="rail-stat-grid">
              <RailStat label="Cooks" value={String(s.cook_count)} />
              <RailStat
                label="Taste"
                value={fmt1(s.avg_taste)}
                color={scoreColor(s.avg_taste)}
                suffix={s.avg_taste != null ? '/5' : ''}
              />
              <RailStat
                label="Texture"
                value={fmt1(s.avg_texture)}
                color={scoreColor(s.avg_texture)}
                suffix={s.avg_texture != null ? '/5' : ''}
              />
              <RailStat
                label="Effort"
                value={fmt1(s.avg_effort)}
                suffix={s.avg_effort != null ? '/5' : ''}
              />
              <RailStat
                label="Remake"
                value={s.make_again_rate != null ? `${Math.round(s.make_again_rate * 100)}%` : '–'}
              />
              <RailStat label="Yield" value={`${formatQty(recipe.yield_qty)}`} suffix={` ${recipe.yield_unit}`} small />
            </div>
            {s.first_cooked && (
              <div className="rail-range">
                {s.cook_count > 1 ? (
                  <>
                    Cooked {s.cook_count}× · {fmtDate(s.first_cooked)} → {fmtDate(s.last_cooked)}
                  </>
                ) : (
                  <>First cooked {fmtDate(s.first_cooked)}</>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Cook log feed */}
      <section className="log-feed-section">
        <div className="spread log-feed-head">
          <h2 className="section-title">
            Cook log <span className="muted">— {pluralize(logs.length, 'entry', 'entries')}, newest first</span>
          </h2>
          <button className="btn primary" onClick={() => setLogging(true)}>
            🔥 Log a cook
          </button>
        </div>

        {logs.length === 0 ? (
          <Empty icon="🔥" title="No cooks logged yet">
            This is the point of the app: each time you make this, note what you changed and how it went. The same
            recipe goes differently on different nights.
            <div style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={() => setLogging(true)}>
                Log your first cook
              </button>
            </div>
          </Empty>
        ) : (
          <div className="log-feed">
            {logs.map((log, i) => (
              <CookLogCard
                key={log.id}
                log={log}
                index={logs.length - i}
                isBest={recipe.best_log?.id === log.id && logs.length > 1}
                onEdit={() => setEditingLog(log)}
                onDelete={() => setDelLog(log)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Sheets */}
      {editRecipe && (
        <RecipeEditor
          dishId={recipe.dish_id}
          existing={recipe}
          tagSuggestions={tags}
          onClose={() => setEditRecipe(false)}
          onSaved={(r) => {
            setEditRecipe(false);
            setRecipe(r);
          }}
        />
      )}
      {logging && (
        <CookLogEditor
          recipeId={recipeId}
          onClose={() => setLogging(false)}
          onSaved={() => {
            setLogging(false);
            load();
          }}
        />
      )}
      {editingLog && (
        <CookLogEditor
          recipeId={recipeId}
          existing={editingLog}
          onClose={() => {
            // Photo deletions inside the sheet hit the server immediately, so
            // even a cancel needs a refetch to keep the feed honest.
            setEditingLog(null);
            load();
          }}
          onSaved={() => {
            setEditingLog(null);
            load();
          }}
        />
      )}
      {confirmDel && (
        <Confirm
          title={`Delete “${recipe.title}”?`}
          body={<>This removes the recipe and its {pluralize(logs.length, 'cook log')}. This can’t be undone.</>}
          onConfirm={deleteRecipe}
          onCancel={() => setConfirmDel(false)}
        />
      )}
      {delLog && (
        <Confirm
          title="Delete this cook log?"
          body={<>The cook from {fmtDate(delLog.cooked_on)} will be removed. This can’t be undone.</>}
          onConfirm={() => removeLog(delLog)}
          onCancel={() => setDelLog(null)}
        />
      )}
    </main>
  );
}

function RailStat({
  label,
  value,
  suffix,
  color,
  small,
}: {
  label: string;
  value: string;
  suffix?: string;
  color?: string;
  small?: boolean;
}) {
  return (
    <div className="rail-stat">
      <span className="rail-stat-label">{label}</span>
      <span className="rail-stat-value mono" style={{ color, fontSize: small ? 15 : undefined }}>
        {value}
        {suffix && <span className="rail-stat-suffix">{suffix}</span>}
      </span>
    </div>
  );
}

/**
 * The thesis of the whole app, surfaced. When one cook clearly beat the others,
 * show WHAT was different that night — "4 stars when you cold-ferment," not
 * just "4 stars."
 */
function BestLogCallout({ recipe }: { recipe: RecipeDetail }) {
  const best = recipe.best_log;
  if (!best || recipe.cook_logs.length < 2) return null;
  const score = cookScore(best);
  if (score == null) return null;

  return (
    <div className="best-callout">
      <div className="best-badge">
        <span className="best-star">★</span> Best cook
      </div>
      <div className="best-body">
        <div className="row" style={{ gap: 8, marginBottom: 2 }}>
          <span className="mono" style={{ color: scoreColor(score), fontWeight: 700 }}>
            {fmt1(score)}/5
          </span>
          <span className="muted">· {fmtDate(best.cooked_on)}</span>
        </div>
        {best.changes ? (
          <div className="best-changes">
            <span className="muted">What was different:</span> {best.changes}
          </div>
        ) : (
          <div className="muted">Cooked to the base recipe with no changes.</div>
        )}
      </div>
    </div>
  );
}

function ScaleControl({
  recipe,
  factor,
  onChange,
}: {
  recipe: RecipeDetail;
  factor: number;
  onChange: (f: number) => void;
}) {
  const scaledYield = formatQty(recipe.yield_qty * factor);
  return (
    <div className="scale-control">
      <div className="segmented compact">
        {SCALE_PRESETS.map((p) => (
          <button key={p} className={`seg ${Math.abs(factor - p) < 1e-6 ? 'on' : ''}`} onClick={() => onChange(p)}>
            {p === 1 ? '1×' : `${formatQty(p)}×`}
          </button>
        ))}
      </div>
      <span className="scale-yield mono" title="Scaled yield">
        → {scaledYield} {recipe.yield_unit}
        {recipe.yield_unit === 'serving' && recipe.yield_qty * factor !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

function IngredientList({ ingredients, factor }: { ingredients: Ingredient[]; factor: number }) {
  // Group by section, preserving first-seen order. Ungrouped rows come first.
  const groups = useMemo(() => {
    const map = new Map<string, Ingredient[]>();
    for (const i of ingredients) {
      const key = i.section || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(i);
    }
    return Array.from(map.entries());
  }, [ingredients]);

  return (
    <div className="ingredients">
      {groups.map(([section, items]) => (
        <div key={section} className="ing-group">
          {section && <div className="ing-section-label">{section}</div>}
          <ul className="ing-list">
            {items.map((ing) => (
              <li key={ing.id} className="ing-item">
                <span className="ing-qty mono">
                  {ing.qty != null ? (
                    <>
                      <span className={factor !== 1 ? 'scaled' : ''}>{scaleQty(ing.qty, factor)}</span>
                      {ing.unit && <span className="ing-unit"> {ing.unit}</span>}
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </span>
                <span className="ing-name">
                  {ing.item}
                  {ing.note && <span className="ing-note"> · {ing.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
