import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { SearchHit } from '@shared/types';

const KIND_ICON: Record<string, string> = { dish: '🍽', recipe: '📋', cook_log: '🔥' };
const KIND_LABEL: Record<string, string> = { dish: 'Dish', recipe: 'Recipe', cook_log: 'Cook log' };

/** FTS snippets arrive as raw note text with <mark> tags spliced in. Escape
 *  everything, then let only our own marks back through — note text must
 *  never reach the DOM as live HTML. */
function snippetHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;mark&gt;/g, '<mark>')
    .replace(/&lt;\/mark&gt;/g, '</mark>');
}

/**
 * Global full-text search. Cmd/Ctrl-K focuses it from anywhere; typing shows a
 * live dropdown of hits across dishes, recipes and cook logs; arrow keys +
 * Enter navigate. Built for keyboard-first use.
 */
export function SearchBar() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  // Debounced query.
  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await api.search(q);
        if (mine === seq.current) {
          setHits(res);
          setActive(0);
          setOpen(true);
        }
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 130);
    return () => clearTimeout(t);
  }, [q]);

  // Global Cmd/Ctrl-K and "/" to focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !isTyping())) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const go = useCallback(
    (hit: SearchHit) => {
      setOpen(false);
      setQ('');
      inputRef.current?.blur();
      if (hit.kind === 'dish') nav(`/dish/${hit.ref_id}`);
      else if (hit.kind === 'recipe') nav(`/recipe/${hit.ref_id}`);
      else nav(`/recipe/${hit.recipe_id}#log-${hit.ref_id}`);
    },
    [nav],
  );

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="topbar-search" ref={boxRef}>
      <div className="search-input-wrap">
        <span className="search-icon" aria-hidden>
          🔎
        </span>
        <input
          ref={inputRef}
          type="search"
          value={q}
          placeholder="Search recipes, ingredients, cook notes…"
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => q && setOpen(true)}
          onKeyDown={onKey}
          aria-label="Search"
          spellCheck={false}
        />
        <kbd className="search-kbd">⌘K</kbd>
      </div>
      {open && q.trim() && (
        <div className="search-results" role="listbox">
          {loading && !hits.length && <div className="search-empty">Searching…</div>}
          {!loading && !hits.length && <div className="search-empty">No matches for “{q}”</div>}
          {hits.map((hit, i) => (
            <button
              key={`${hit.kind}-${hit.ref_id}`}
              role="option"
              aria-selected={i === active}
              className={`search-hit ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(hit)}
            >
              <span className="search-hit-icon" aria-hidden>
                {KIND_ICON[hit.kind]}
              </span>
              <span className="search-hit-body">
                <span className="search-hit-title">{hit.title}</span>
                {hit.snippet && (
                  <span className="search-hit-snip" dangerouslySetInnerHTML={{ __html: snippetHtml(hit.snippet) }} />
                )}
                <span className="search-hit-ctx">
                  <span className="kind-tag">{KIND_LABEL[hit.kind]}</span>
                  {hit.context && hit.kind !== 'dish' && <span> · {hit.context}</span>}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function isTyping(): boolean {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
}
