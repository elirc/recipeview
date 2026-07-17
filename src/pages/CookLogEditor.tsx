import { useState, useRef, useEffect } from 'react';
import { Sheet } from '../components/Sheet';
import { PipInput } from '../components/bits';
import { useToast } from '../components/Toast';
import { api } from '../api';
import { MAKE_AGAIN, type CookLog, type MakeAgain } from '@shared/types';
import { todayISO } from '../lib/format';

const MAKE_AGAIN_META: Record<MakeAgain, { label: string; icon: string }> = {
  yes: { label: 'Yes', icon: '↑' },
  maybe: { label: 'Maybe', icon: '~' },
  no: { label: 'No', icon: '↓' },
};

/**
 * The cook log editor. Deltas ("what I changed") and the two note fields are
 * first-class and sit above the ratings, because logging *what happened* is the
 * point; the stars are secondary. Photos upload after the log row exists.
 */
export function CookLogEditor({
  recipeId,
  existing,
  onClose,
  onSaved,
}: {
  recipeId: number;
  existing?: CookLog;
  onClose: () => void;
  onSaved: (log: CookLog) => void;
}) {
  const toast = useToast();
  const [cookedOn, setCookedOn] = useState(existing?.cooked_on ?? todayISO());
  const [changes, setChanges] = useState(existing?.changes ?? '');
  const [taste, setTaste] = useState(existing?.taste_notes ?? '');
  const [process, setProcess] = useState(existing?.process_notes ?? '');
  const [nextTime, setNextTime] = useState(existing?.next_time ?? '');
  const [rTaste, setRTaste] = useState<number | null>(existing?.rating_taste ?? null);
  const [rTexture, setRTexture] = useState<number | null>(existing?.rating_texture ?? null);
  const [rEffort, setREffort] = useState<number | null>(existing?.rating_effort ?? null);
  const [makeAgain, setMakeAgain] = useState<MakeAgain | null>(existing?.make_again ?? null);
  // Local copy of saved photos — never mutate the prop; the parent refetches
  // on close to reconcile.
  const [photos, setPhotos] = useState(existing?.photos ?? []);
  // Each pending file gets its object URL exactly once; revoked on remove/unmount.
  const [pending, setPending] = useState<{ file: File; url: string }[]>([]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Once a new log row exists, retries must UPDATE it — otherwise a failed
  // photo upload followed by a second click would create a duplicate log.
  const savedId = useRef<number | null>(existing?.id ?? null);

  const save = async () => {
    setSaving(true);
    const payload = {
      cooked_on: cookedOn,
      changes,
      taste_notes: taste,
      process_notes: process,
      next_time: nextTime,
      rating_taste: rTaste,
      rating_texture: rTexture,
      rating_effort: rEffort,
      make_again: makeAgain,
    };
    try {
      let log: CookLog;
      if (savedId.current == null) {
        log = await api.createLog(recipeId, payload);
        savedId.current = log.id;
      } else {
        log = await api.updateLog(savedId.current, payload);
      }
      if (pending.length) {
        const uploaded = await api.uploadPhotos(log.id, pending.map((p) => p.file));
        // The server silently drops non-image files; tell the user if any vanished.
        if (uploaded.length < photos.length + pending.length) {
          toast('Some files were skipped — images only', 'err');
        }
        log = { ...log, photos: uploaded };
      }
      toast(existing ? 'Cook log updated' : 'Cook logged 🔥');
      onSaved(log);
    } catch (e) {
      toast((e as Error).message, 'err');
      setSaving(false);
    }
  };

  const removeExistingPhoto = async (id: number) => {
    try {
      await api.deletePhoto(id);
      setPhotos((cur) => cur.filter((p) => p.id !== id));
      toast('Photo removed');
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };

  const removePending = (idx: number) => {
    setPending((cur) => {
      URL.revokeObjectURL(cur[idx].url);
      return cur.filter((_, i) => i !== idx);
    });
  };

  return (
    <Sheet
      title={existing ? 'Edit cook log' : 'Log a cook'}
      onClose={onClose}
      footer={
        <>
          <span className="hint grow">
            <kbd>⌘</kbd> <kbd>Enter</kbd> to save
          </span>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : existing ? 'Save' : 'Log it'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }} onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && save()}>
        <div className="field" style={{ maxWidth: 200 }}>
          <label htmlFor="cl-date">Date cooked</label>
          <input id="cl-date" type="date" value={cookedOn} max={todayISO()} onChange={(e) => setCookedOn(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="cl-changes">
            What I changed <span className="tag-hint">deltas from the base recipe</span>
          </label>
          <textarea
            id="cl-changes"
            value={changes}
            onChange={(e) => setChanges(e.target.value)}
            placeholder="Bread flour instead of 00 · fermented 72h · dropped oven to 500°F"
            rows={2}
            autoFocus
          />
        </div>

        {/* Ratings — compact grid, thumb-friendly */}
        <div className="rating-grid">
          <div className="rating-cell">
            <span className="label">Taste</span>
            <PipInput value={rTaste} onChange={setRTaste} color="var(--good)" labels={['off', 'incredible']} />
          </div>
          <div className="rating-cell">
            <span className="label">Texture</span>
            <PipInput value={rTexture} onChange={setRTexture} color="var(--untested)" labels={['wrong', 'perfect']} />
          </div>
          <div className="rating-cell">
            <span className="label">Effort</span>
            <PipInput value={rEffort} onChange={setREffort} color="var(--needs-work)" labels={['easy', 'grueling']} />
          </div>
          <div className="rating-cell">
            <span className="label">Make again?</span>
            <div className="segmented compact">
              {MAKE_AGAIN.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`seg ma-${v} ${makeAgain === v ? 'on' : ''}`}
                  onClick={() => setMakeAgain(makeAgain === v ? null : v)}
                >
                  <span className="ma-icon">{MAKE_AGAIN_META[v].icon}</span> {MAKE_AGAIN_META[v].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="cl-taste">Taste notes</label>
            <textarea
              id="cl-taste"
              value={taste}
              onChange={(e) => setTaste(e.target.value)}
              placeholder="Flavor, seasoning, balance…"
              rows={3}
            />
          </div>
          <div className="field">
            <label htmlFor="cl-process">
              Process notes <span className="tag-hint">kept separate on purpose</span>
            </label>
            <textarea
              id="cl-process"
              value={process}
              onChange={(e) => setProcess(e.target.value)}
              placeholder="Dough tore · sauce split · undershot the bake…"
              rows={3}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="cl-next">Next time I should…</label>
          <textarea
            id="cl-next"
            value={nextTime}
            onChange={(e) => setNextTime(e.target.value)}
            placeholder="One concrete change to try next cook."
            rows={2}
          />
        </div>

        {/* Photos */}
        <div className="field">
          <span className="label">Photos</span>
          <div className="photo-edit-grid">
            {photos.map((p) => (
              <div key={p.id} className="photo-thumb">
                <img src={`/photos/${p.filename}`} alt={p.caption || 'Cook photo'} loading="lazy" />
                <button type="button" className="photo-del" onClick={() => removeExistingPhoto(p.id)} aria-label="Delete photo">
                  ✕
                </button>
              </div>
            ))}
            {pending.map((p, i) => (
              <div key={p.url} className="photo-thumb pending">
                <img src={p.url} alt="" />
                <button type="button" className="photo-del" onClick={() => removePending(i)} aria-label="Remove">
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="photo-add" onClick={() => fileRef.current?.click()}>
              <span style={{ fontSize: 22 }}>📷</span>
              <span className="hint">Add</span>
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              setPending((cur) => [...cur, ...files.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </Sheet>
  );
}
