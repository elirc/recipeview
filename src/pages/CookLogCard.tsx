import { useState } from 'react';
import type { CookLog } from '@shared/types';
import { Pips } from '../components/bits';
import { fmtDate, fmtWhen, makeAgainLabel, scoreColor } from '../lib/format';
import { cookScore } from '@shared/types';

/**
 * One cook, in the feed. The layout deliberately keeps the four kinds of
 * information visually distinct:
 *   - the DELTA (what changed) is the headline, tinted, above everything
 *   - taste notes and process notes get separate labeled blocks
 *   - ratings are a compact strip, not the star-rating the whole card reduces to
 *   - "next time" is a call-to-action footer
 * That separation is the difference between a cook log and a star review.
 */
export function CookLogCard({
  log,
  index,
  isBest,
  onEdit,
  onDelete,
}: {
  log: CookLog;
  index: number;
  isBest: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const score = cookScore(log);
  const hasRatings = log.rating_taste != null || log.rating_texture != null || log.rating_effort != null;
  const hasNotes = log.taste_notes || log.process_notes;
  // For older cooks the relative label collapses back to the exact date, which
  // would just repeat the headline. Only show it when it says something new.
  const dateFull = fmtDate(log.cooked_on);
  const when = fmtWhen(log.cooked_on);

  return (
    <article className={`log-card card ${isBest ? 'is-best' : ''}`} id={`log-${log.id}`}>
      <div className="log-rail">
        <span className="log-index" title={`Cook #${index}`}>
          #{index}
        </span>
        {score != null && <span className="log-score mono" style={{ color: scoreColor(score) }}>{score.toFixed(1)}</span>}
      </div>

      <div className="log-content">
        <header className="log-head">
          <div className="row" style={{ gap: 8 }}>
            <time className="log-date" dateTime={log.cooked_on}>
              {dateFull}
            </time>
            {when !== dateFull && <span className="muted log-when">{when}</span>}
            {isBest && <span className="best-pill">★ best</span>}
          </div>
          <div className="log-actions">
            <button className="btn icon ghost sm" onClick={onEdit} aria-label="Edit cook log" title="Edit">
              ✎
            </button>
            <button className="btn icon ghost sm danger" onClick={onDelete} aria-label="Delete cook log" title="Delete">
              🗑
            </button>
          </div>
        </header>

        {/* The delta — headline of the cook */}
        {log.changes ? (
          <div className="log-changes">
            <span className="log-changes-label">Changed</span>
            <span className="log-changes-text">{log.changes}</span>
          </div>
        ) : (
          <div className="log-baserun muted">Cooked to the base recipe — no changes</div>
        )}

        {/* Ratings strip */}
        {(hasRatings || log.make_again) && (
          <div className="log-ratings">
            {log.rating_taste != null && (
              <span className="log-rating">
                <span className="lr-label">Taste</span>
                <Pips value={log.rating_taste} color="var(--good)" />
              </span>
            )}
            {log.rating_texture != null && (
              <span className="log-rating">
                <span className="lr-label">Texture</span>
                <Pips value={log.rating_texture} color="var(--untested)" />
              </span>
            )}
            {log.rating_effort != null && (
              <span className="log-rating">
                <span className="lr-label">Effort</span>
                <Pips value={log.rating_effort} color="var(--needs-work)" />
              </span>
            )}
            {log.make_again && (
              <span className={`make-again-chip ma-${log.make_again}`}>{makeAgainLabel(log.make_again)}</span>
            )}
          </div>
        )}

        {/* Notes — taste and process kept apart */}
        {hasNotes && (
          <div className="log-notes">
            {log.taste_notes && (
              <div className="log-note">
                <span className="log-note-label taste">Taste</span>
                <p>{log.taste_notes}</p>
              </div>
            )}
            {log.process_notes && (
              <div className="log-note">
                <span className="log-note-label process">Process</span>
                <p>{log.process_notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Photos */}
        {log.photos.length > 0 && (
          <div className="log-photos">
            {log.photos.map((p) => (
              <button key={p.id} className="log-photo" onClick={() => setLightbox(`/photos/${p.filename}`)}>
                <img src={`/photos/${p.filename}`} alt={p.caption || 'Cook photo'} loading="lazy" />
              </button>
            ))}
          </div>
        )}

        {/* Next time */}
        {log.next_time && (
          <div className="log-next">
            <span className="log-next-icon">→</span>
            <span>
              <span className="log-next-label">Next time:</span> {log.next_time}
            </span>
          </div>
        )}
      </div>

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
          <button className="lightbox-close" aria-label="Close">
            ✕
          </button>
        </div>
      )}
    </article>
  );
}
