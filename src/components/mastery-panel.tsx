"use client";

import { formatPercent } from "@/lib/client/format";
import { MASTERY_THRESHOLD } from "@/lib/mastery/bkt";
import { weakestConcepts, type MasteryRecord } from "@/lib/mastery/store";

/** Turns "pendulum-period" into "pendulum period" for display. */
function humanize(slug: string): string {
  return slug.replace(/[-_]/g, " ");
}

export function MasteryPanel({
  record,
  onReset,
}: {
  record: MasteryRecord;
  onReset: () => void;
}) {
  const entries = Object.entries(record.concepts)
    .filter(
      (entry): entry is [string, NonNullable<(typeof entry)[1]>] =>
        entry[1] !== undefined,
    )
    .sort(([, a], [, b]) => b.pKnown - a.pKnown);
  const weakest = weakestConcepts(record, 1).filter(
    (id) => (record.concepts[id]?.pKnown ?? 1) < MASTERY_THRESHOLD,
  )[0];

  return (
    <aside className="panel" aria-label="Mastery tracker">
      <p className="kicker">Mastery</p>
      <h2>What you&apos;ve locked in</h2>
      {entries.length === 0 ? (
        <p className="mastery-empty">
          Nothing tracked yet — make a prediction and your per-concept mastery
          shows up here. It stays on this device.
        </p>
      ) : (
        <>
          <div className="mastery-list">
            {entries.map(([conceptId, state]) => (
              <div className="mastery-row" key={conceptId}>
                <div className="label-line">
                  <span className="concept">{humanize(conceptId)}</span>
                  <span className="value">
                    {state.pKnown >= MASTERY_THRESHOLD ? (
                      <span className="badge ok">mastered</span>
                    ) : (
                      formatPercent(state.pKnown)
                    )}
                  </span>
                </div>
                <div className="track" aria-hidden>
                  <div
                    className="fill"
                    style={{ width: `${Math.round(state.pKnown * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          {weakest ? (
            <p className="next-up">
              Next up: <strong>{humanize(weakest)}</strong> could use another
              round.
            </p>
          ) : null}
          <p className="next-up">
            <button type="button" className="btn subtle" onClick={onReset}>
              Reset progress
            </button>
          </p>
        </>
      )}
    </aside>
  );
}
