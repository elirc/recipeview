import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { Dish, DishDetail } from '@shared/types';
import { Empty, Spinner } from '../components/bits';
import { DishEditor } from './DishEditor';
import { fmt1, fmtWhen, pluralize, scoreColor } from '../lib/format';

type Sort = 'recent' | 'name' | 'cooks';
const SORTS: { key: Sort; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'name', label: 'A–Z' },
  { key: 'cooks', label: 'Most cooked' },
];

export function HomePage() {
  const [params, setParams] = useSearchParams();
  const [dishes, setDishes] = useState<Dish[] | null>(null);
  const [sort, setSort] = useState<Sort>('recent');
  const [tag, setTag] = useState<string | null>(null);
  const [tags, setTags] = useState<{ name: string; uses: number }[]>([]);
  const [editing, setEditing] = useState(false);
  const nav = useNavigate();

  const load = useCallback(async () => {
    const [d, t] = await Promise.all([api.listDishes({ sort, tag: tag ?? undefined }), api.tags()]);
    setDishes(d);
    setTags(t);
  }, [sort, tag]);

  useEffect(() => {
    load();
  }, [load]);

  // ?new=1 opens the create sheet (used by the top-bar button from any page).
  useEffect(() => {
    if (params.get('new')) {
      setEditing(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const onCreated = (dish: DishDetail) => {
    // Land on the new dish — adding a recipe to it is the near-certain next step.
    setEditing(false);
    nav(`/dish/${dish.id}`);
  };

  if (!dishes) return <Spinner />;

  const totalCooks = dishes.reduce((n, d) => n + d.cook_count, 0);

  return (
    <main className="content">
      <div className="page-head">
        <div>
          <h1 className="page-title">Your dishes</h1>
          <p className="page-sub">
            {dishes.length ? (
              <>
                {pluralize(dishes.length, 'dish', 'dishes')} · {pluralize(totalCooks, 'cook')} logged
              </>
            ) : (
              'A lab notebook for the things you cook.'
            )}
          </p>
        </div>
        <div className="segmented">
          {SORTS.map((s) => (
            <button key={s.key} className={`seg ${sort === s.key ? 'on' : ''}`} onClick={() => setSort(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {tags.length > 0 && (
        <div className="tag-filter">
          <button className={`tag ${!tag ? 'active' : ''}`} onClick={() => setTag(null)}>
            All
          </button>
          {tags.map((t) => (
            <button key={t.name} className={`tag ${tag === t.name ? 'active' : ''}`} onClick={() => setTag(tag === t.name ? null : t.name)}>
              {t.name} <span className="tag-count">{t.uses}</span>
            </button>
          ))}
        </div>
      )}

      {dishes.length === 0 ? (
        tag ? (
          <Empty icon="🏷️" title={`No dishes tagged “${tag}”`}>
            <button className="btn ghost" onClick={() => setTag(null)}>
              Clear filter
            </button>
          </Empty>
        ) : (
          <Empty icon="🧪" title="No dishes yet">
            Start with something you make often. Then log how each cook actually went.
            <div style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={() => setEditing(true)}>
                + New dish
              </button>
            </div>
          </Empty>
        )
      ) : (
        <div className="dish-grid">
          {dishes.map((d) => (
            <DishCard key={d.id} dish={d} />
          ))}
          <button className="dish-card add" onClick={() => setEditing(true)}>
            <span style={{ fontSize: 26 }}>+</span>
            <span>New dish</span>
          </button>
        </div>
      )}

      {editing && <DishEditor tagSuggestions={tags.map((t) => t.name)} onClose={() => setEditing(false)} onSaved={onCreated} />}
    </main>
  );
}

function DishCard({ dish }: { dish: Dish }) {
  return (
    <Link to={`/dish/${dish.id}`} className="dish-card">
      <div className="dish-card-head">
        <h3 className="dish-name">{dish.name}</h3>
        {dish.has_keeper && (
          <span className="keeper-star" title="Has a keeper recipe">
            ★
          </span>
        )}
      </div>

      {dish.notes && <p className="dish-notes">{dish.notes}</p>}

      <div className="dish-meta">
        <span className="dish-metric">
          <b>{dish.recipe_count}</b> {dish.recipe_count === 1 ? 'recipe' : 'recipes'}
        </span>
        <span className="dot">·</span>
        <span className="dish-metric">
          <b>{dish.cook_count}</b> {dish.cook_count === 1 ? 'cook' : 'cooks'}
        </span>
        {dish.best_score != null && (
          <>
            <span className="dot">·</span>
            <span className="dish-metric" title="Best average score across recipes">
              <span className="score-dot" style={{ background: scoreColor(dish.best_score) }} />
              <b className="mono">{fmt1(dish.best_score)}</b> best
            </span>
          </>
        )}
      </div>

      <div className="dish-card-foot">
        {dish.tags.length > 0 && (
          <div className="tag-row">
            {dish.tags.slice(0, 3).map((t) => (
              <span key={t.id} className="tag mini">
                {t.name}
              </span>
            ))}
          </div>
        )}
        <span className="dish-last">{dish.last_cooked ? `Cooked ${fmtWhen(dish.last_cooked)}` : 'Never cooked'}</span>
      </div>
    </Link>
  );
}
