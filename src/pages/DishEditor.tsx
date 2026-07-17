import { useState } from 'react';
import { Sheet } from '../components/Sheet';
import { TagInput, useAutoFocus } from '../components/TagInput';
import { useToast } from '../components/Toast';
import { api } from '../api';
import type { DishDetail } from '@shared/types';

export function DishEditor({
  existing,
  tagSuggestions,
  onClose,
  onSaved,
}: {
  existing?: DishDetail;
  tagSuggestions: string[];
  onClose: () => void;
  onSaved: (dish: DishDetail) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [tags, setTags] = useState<string[]>(existing?.tags.map((t) => t.name) ?? []);
  const [saving, setSaving] = useState(false);
  const bodyRef = useAutoFocus<HTMLDivElement>();

  const save = async () => {
    if (!name.trim()) {
      toast('Give the dish a name', 'err');
      return;
    }
    setSaving(true);
    try {
      const dish = existing
        ? await api.updateDish(existing.id, { name, notes, tags })
        : await api.createDish({ name, notes, tags });
      toast(existing ? 'Dish updated' : 'Dish created');
      onSaved(dish);
    } catch (e) {
      toast((e as Error).message, 'err');
      setSaving(false);
    }
  };

  return (
    <Sheet
      title={existing ? 'Edit dish' : 'New dish'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : existing ? 'Save' : 'Create dish'}
          </button>
        </>
      }
    >
      <div ref={bodyRef} className="stack" style={{ gap: 16 }}>
        <div className="field">
          <label htmlFor="dish-name">Dish name</label>
          <input
            id="dish-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pizza, Ramen, Chocolate chip cookies…"
            onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && save()}
          />
          <span className="hint">The thing you want to make. Specific recipes live inside it.</span>
        </div>
        <div className="field">
          <label htmlFor="dish-notes">Notes</label>
          <textarea
            id="dish-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What are you chasing with this dish? Open questions, the ideal you're after…"
            rows={3}
          />
        </div>
        <div className="field">
          <span className="label">Tags</span>
          <TagInput value={tags} onChange={setTags} suggestions={tagSuggestions} placeholder="italian, weeknight, project…" />
        </div>
      </div>
    </Sheet>
  );
}
