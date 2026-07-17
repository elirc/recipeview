import { useState, useRef, useEffect } from 'react';

/**
 * Chip-style tag editor with suggestions. Enter or comma commits a tag,
 * Backspace on an empty field removes the last one. Case-insensitive dedupe.
 */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = 'Add tag…',
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (raw: string) => {
    const t = raw.trim().replace(/^#/, '').replace(/,$/, '').trim();
    if (!t) return;
    if (value.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...value, t]);
    setDraft('');
  };

  const remove = (t: string) => onChange(value.filter((x) => x !== t));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      remove(value[value.length - 1]);
    }
  };

  const matches =
    draft.trim().length > 0
      ? suggestions
          .filter((s) => s.toLowerCase().includes(draft.toLowerCase()) && !value.some((v) => v.toLowerCase() === s.toLowerCase()))
          .slice(0, 6)
      : [];

  return (
    <div className="taginput" onClick={() => inputRef.current?.focus()}>
      {value.map((t) => (
        <span key={t} className="tag" style={{ paddingRight: 4 }}>
          {t}
          <button type="button" className="tag-x" onClick={() => remove(t)} aria-label={`Remove ${t}`}>
            ✕
          </button>
        </span>
      ))}
      <div className="taginput-field">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => add(draft)}
          placeholder={value.length ? '' : placeholder}
        />
        {matches.length > 0 && (
          <div className="suggest" onMouseDown={(e) => e.preventDefault()}>
            {matches.map((m) => (
              <button key={m} type="button" className="suggest-item" onClick={() => add(m)}>
                {m}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Focus the first input inside a form/sheet on mount. Kitchen-friendly: open
 *  the sheet and start typing without reaching for the mouse. */
export function useAutoFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('input, textarea, select');
    el?.focus();
  }, []);
  return ref;
}
