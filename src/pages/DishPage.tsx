import { useEffect, useState, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { DishDetail, Recipe } from '@shared/types';
import { Empty, Spinner, VerdictBadge, ScoreBar } from '../components/bits';
import { DishEditor } from './DishEditor';
import { RecipeEditor } from './RecipeEditor';
import { Confirm } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { fmt1, fmtWhen, pluralize } from '../lib/format';

export function DishPage() {
  const { id } = useParams();
  const dishId = Number(id);
  const nav = useNavigate();
  const toast = useToast();
  const [dish, setDish] = useState<DishDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [editDish, setEditDish] = useState(false);
  const [addRecipe, setAddRecipe] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, t] = await Promise.all([api.getDish(dishId), api.tags()]);
      setDish(d);
      setTags(t.map((x) => x.name));
    } catch {
      setMissing(true);
    }
  }, [dishId]);

  useEffect(() => {
    load();
  }, [load]);

  if (missing) return <Empty icon="🤷" title="Dish not found">{<Link to="/">Back home</Link>}</Empty>;
  if (!dish) return <Spinner />;

  const deleteDish = async () => {
    try {
      await api.deleteDish(dishId);
      toast('Dish deleted');
      nav('/');
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };

  const recipes = dish.recipes;

  return (
    <main className="content">
      <nav className="crumbs">
        <Link to="/">Dishes</Link>
        <span className="sep">/</span>
        <span>{dish.name}</span>
      </nav>

      <div className="dish-hero">
        <div className="grow">
          <h1 className="page-title">{dish.name}</h1>
          {dish.notes && <p className="dish-hero-notes">{dish.notes}</p>}
          <div className="row wrap" style={{ gap: 10, marginTop: 8 }}>
            {dish.tags.map((t) => (
              <span key={t.id} className="tag">
                {t.name}
              </span>
            ))}
            <span className="muted" style={{ fontSize: 13.5 }}>
              {pluralize(recipes.length, 'recipe')} · {pluralize(dish.cook_count, 'cook')}
              {dish.last_cooked && <> · last cooked {fmtWhen(dish.last_cooked)}</>}
            </span>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost sm" onClick={() => setEditDish(true)}>
            Edit
          </button>
          <button className="btn danger ghost sm" onClick={() => setConfirmDel(true)}>
            Delete
          </button>
        </div>
      </div>

      <div className="spread" style={{ margin: '22px 0 12px' }}>
        <h2 className="section-title">
          Recipes <span className="muted">— side by side</span>
        </h2>
        <button className="btn primary sm" onClick={() => setAddRecipe(true)}>
          + Add recipe
        </button>
      </div>

      {recipes.length === 0 ? (
        <Empty icon="📋" title="No recipes yet">
          A recipe is one approach to {dish.name} — a specific hydration, ferment, or technique.
          <div style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={() => setAddRecipe(true)}>
              + Add the first recipe
            </button>
          </div>
        </Empty>
      ) : (
        <div className="recipe-compare">
          {recipes.map((r) => (
            <RecipeCompareCard key={r.id} recipe={r} />
          ))}
        </div>
      )}

      {editDish && (
        <DishEditor
          existing={dish}
          tagSuggestions={tags}
          onClose={() => setEditDish(false)}
          onSaved={(d) => {
            setEditDish(false);
            setDish((cur) => (cur ? { ...cur, ...d } : d));
          }}
        />
      )}
      {addRecipe && (
        <RecipeEditor
          dishId={dishId}
          tagSuggestions={tags}
          onClose={() => setAddRecipe(false)}
          onSaved={(r) => {
            setAddRecipe(false);
            nav(`/recipe/${r.id}`);
          }}
        />
      )}
      {confirmDel && (
        <Confirm
          title={`Delete “${dish.name}”?`}
          body={
            <>
              This removes the dish and all {pluralize(recipes.length, 'recipe')} and their cook logs. This can’t be
              undone.
            </>
          }
          onConfirm={deleteDish}
          onCancel={() => setConfirmDel(false)}
        />
      )}
    </main>
  );
}

function RecipeCompareCard({ recipe }: { recipe: Recipe }) {
  const s = recipe.stats;
  const overall =
    s.avg_taste != null || s.avg_texture != null
      ? ((s.avg_taste ?? s.avg_texture)! + (s.avg_texture ?? s.avg_taste)!) / 2
      : null;

  return (
    <Link to={`/recipe/${recipe.id}`} className="compare-card card">
      <div className="compare-head">
        <VerdictBadge verdict={recipe.verdict} />
        {overall != null && (
          <span className="compare-overall" title="Overall (taste + texture)">
            <span className="mono big">{fmt1(overall)}</span>
            <span className="muted">/5</span>
          </span>
        )}
      </div>

      <h3 className="compare-title">{recipe.title}</h3>
      {recipe.source_name && <div className="compare-source">from {recipe.source_name}</div>}

      {s.cook_count === 0 ? (
        <div className="compare-untested">Not yet cooked — no ratings</div>
      ) : (
        <div className="compare-scores">
          <ScoreBar label="Taste" value={s.avg_taste} />
          <ScoreBar label="Texture" value={s.avg_texture} />
          <ScoreBar label="Effort" value={s.avg_effort} color="var(--needs-work)" />
        </div>
      )}

      <div className="compare-foot">
        <span className="compare-cooks">
          🔥 {pluralize(s.cook_count, 'cook')}
          {s.make_again_rate != null && <> · {Math.round(s.make_again_rate * 100)}% remake</>}
        </span>
        {s.last_cooked && <span className="muted">{fmtWhen(s.last_cooked)}</span>}
      </div>

      {recipe.tags.length > 0 && (
        <div className="tag-row" style={{ marginTop: 8 }}>
          {recipe.tags.slice(0, 4).map((t) => (
            <span key={t.id} className="tag mini">
              {t.name}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
