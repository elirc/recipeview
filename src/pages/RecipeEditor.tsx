import { useState } from 'react';
import { Sheet } from '../components/Sheet';
import { TagInput } from '../components/TagInput';
import { useToast } from '../components/Toast';
import { api } from '../api';
import { VERDICTS, VERDICT_LABEL, type RecipeDetail, type Verdict } from '@shared/types';
import { parseQty, formatQty } from '@shared/quantity';

type IngRow = { qty: string; unit: string; item: string; note: string; section: string };
type StepRow = { text: string };

const emptyIng = (): IngRow => ({ qty: '', unit: '', item: '', note: '', section: '' });

/** Ingredients come back as structured qty (number|null). Show the number in
 *  kitchen-legible form so editing "0.5" reads as "½". */
function ingToRow(i: RecipeDetail['ingredients'][number]): IngRow {
  return {
    qty: i.qty == null ? '' : formatQty(i.qty, { unicode: false }),
    unit: i.unit,
    item: i.item,
    note: i.note,
    section: i.section,
  };
}

export function RecipeEditor({
  dishId,
  existing,
  tagSuggestions,
  onClose,
  onSaved,
}: {
  dishId: number;
  existing?: RecipeDetail;
  tagSuggestions: string[];
  onClose: () => void;
  onSaved: (r: RecipeDetail) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [sourceName, setSourceName] = useState(existing?.source_name ?? '');
  const [sourceUrl, setSourceUrl] = useState(existing?.source_url ?? '');
  const [verdict, setVerdict] = useState<Verdict>(existing?.verdict ?? 'untested');
  const [yieldQty, setYieldQty] = useState(String(existing?.yield_qty ?? 1));
  const [yieldUnit, setYieldUnit] = useState(existing?.yield_unit ?? 'serving');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [tags, setTags] = useState<string[]>(existing?.tags.map((t) => t.name) ?? []);
  const [ings, setIngs] = useState<IngRow[]>(existing?.ingredients.length ? existing.ingredients.map(ingToRow) : [emptyIng()]);
  const [steps, setSteps] = useState<StepRow[]>(
    existing?.steps.length ? existing.steps.map((s) => ({ text: s.text })) : [{ text: '' }],
  );
  const [saving, setSaving] = useState(false);

  const setIng = (idx: number, patch: Partial<IngRow>) =>
    setIngs((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addIng = () => setIngs((r) => [...r, emptyIng()]);
  const removeIng = (idx: number) => setIngs((r) => (r.length === 1 ? [emptyIng()] : r.filter((_, i) => i !== idx)));

  const setStep = (idx: number, text: string) => setSteps((s) => s.map((r, i) => (i === idx ? { text } : r)));
  const addStep = () => setSteps((s) => [...s, { text: '' }]);
  const removeStep = (idx: number) => setSteps((s) => (s.length === 1 ? [{ text: '' }] : s.filter((_, i) => i !== idx)));

  const save = async () => {
    if (!title.trim()) {
      toast('Give the recipe a title', 'err');
      return;
    }
    setSaving(true);
    const payload = {
      title,
      source_name: sourceName,
      source_url: sourceUrl,
      verdict,
      yield_qty: parseQty(yieldQty) ?? (Number(yieldQty) || 1),
      yield_unit: yieldUnit,
      notes,
      tags,
      ingredients: ings
        .filter((i) => i.item.trim())
        .map((i) => ({ qty: parseQty(i.qty), unit: i.unit, item: i.item, note: i.note, section: i.section })),
      steps: steps.map((s) => s.text).filter((t) => t.trim()),
    };
    try {
      const r = existing ? await api.updateRecipe(existing.id, payload) : await api.createRecipe(dishId, payload);
      toast(existing ? 'Recipe saved' : 'Recipe added');
      onSaved(r);
    } catch (e) {
      toast((e as Error).message, 'err');
      setSaving(false);
    }
  };

  return (
    <Sheet
      wide
      title={existing ? 'Edit recipe' : 'New recipe'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : existing ? 'Save recipe' : 'Add recipe'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 18 }}>
        <div className="field">
          <label htmlFor="r-title">Approach / title</label>
          <input
            id="r-title"
            type="text"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Neapolitan 65% hydration, NY cold-ferment, cast-iron pan…"
          />
          <span className="hint">Name the specific approach — what makes this version different from your others.</span>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="r-src">Source</label>
            <input
              id="r-src"
              type="text"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="Kenji, Tartine p.212, Grandma…"
            />
          </div>
          <div className="field">
            <label htmlFor="r-url">Source link</label>
            <input id="r-url" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <span className="label">Verdict</span>
            <div className="segmented">
              {VERDICTS.map((v) => (
                <button key={v} type="button" className={`seg ${verdict === v ? 'on' : ''} v-${v}`} onClick={() => setVerdict(v)}>
                  {VERDICT_LABEL[v]}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label">Base yield</span>
            <div className="row" style={{ gap: 8 }}>
              <input
                type="text"
                value={yieldQty}
                onChange={(e) => setYieldQty(e.target.value)}
                style={{ width: 80 }}
                inputMode="decimal"
                aria-label="Yield quantity"
              />
              <input
                type="text"
                value={yieldUnit}
                onChange={(e) => setYieldUnit(e.target.value)}
                placeholder="servings, pizzas, dozen…"
                aria-label="Yield unit"
              />
            </div>
            <span className="hint">What the ingredient amounts below make. Scaling is calculated from this.</span>
          </div>
        </div>

        {/* Ingredients */}
        <div className="editor-block">
          <div className="spread" style={{ marginBottom: 8 }}>
            <span className="label" style={{ margin: 0 }}>
              Ingredients
            </span>
            <span className="hint">qty · unit · item — leave qty blank for “to taste”</span>
          </div>
          <div className="ing-editor">
            {ings.map((ing, i) => (
              <div key={i} className="ing-edit-row">
                <input
                  className="ie-qty"
                  value={ing.qty}
                  onChange={(e) => setIng(i, { qty: e.target.value })}
                  placeholder="1½"
                  aria-label="Quantity"
                  inputMode="decimal"
                />
                <input
                  className="ie-unit"
                  value={ing.unit}
                  onChange={(e) => setIng(i, { unit: e.target.value })}
                  placeholder="cup"
                  aria-label="Unit"
                />
                <input
                  className="ie-item"
                  value={ing.item}
                  onChange={(e) => setIng(i, { item: e.target.value })}
                  placeholder="00 flour"
                  aria-label="Ingredient"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (i === ings.length - 1) addIng();
                    }
                  }}
                />
                <input
                  className="ie-note"
                  value={ing.note}
                  onChange={(e) => setIng(i, { note: e.target.value })}
                  placeholder="sifted (optional)"
                  aria-label="Note"
                />
                <button type="button" className="btn icon ghost" onClick={() => removeIng(i)} aria-label="Remove ingredient" title="Remove">
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn sm ghost add-row" onClick={addIng}>
            + Ingredient
          </button>
        </div>

        {/* Steps */}
        <div className="editor-block">
          <span className="label">Steps</span>
          <div className="step-editor">
            {steps.map((s, i) => (
              <div key={i} className="step-edit-row">
                <span className="step-num">{i + 1}</span>
                <textarea
                  value={s.text}
                  onChange={(e) => setStep(i, e.target.value)}
                  placeholder="Describe the step…"
                  rows={2}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      if (i === steps.length - 1) addStep();
                    }
                  }}
                />
                <button type="button" className="btn icon ghost" onClick={() => removeStep(i)} aria-label="Remove step" title="Remove">
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn sm ghost add-row" onClick={addStep}>
            + Step
          </button>
        </div>

        <div className="field">
          <label htmlFor="r-notes">Recipe notes</label>
          <textarea
            id="r-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Headnotes, equipment, the theory behind this approach…"
            rows={3}
          />
        </div>

        <div className="field">
          <span className="label">Tags</span>
          <TagInput value={tags} onChange={setTags} suggestions={tagSuggestions} placeholder="sourdough, quick, technique…" />
        </div>
      </div>
    </Sheet>
  );
}
