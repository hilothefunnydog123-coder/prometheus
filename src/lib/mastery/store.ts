import { z } from "zod";
import { slugSchema } from "@/lib/ai/contracts/experiment-spec";
import {
  BKT_DEFAULTS,
  MASTERY_THRESHOLD,
  initialMastery,
  updateMastery,
  type BktParams,
} from "./bkt";

/**
 * Serializable per-learner mastery record on top of the pure BKT functions.
 *
 * Pure and I/O-free like bkt.ts: the caller (the UI) decides where the
 * record lives (localStorage for the hackathon) and passes timestamps in.
 * Deserialization is total — corrupt or stale data from localStorage
 * degrades to a fresh record instead of throwing at app startup.
 */

export const MASTERY_STORE_VERSION = 1 as const;

export const conceptStateSchema = z
  .object({
    /** Current P(known) for this concept. */
    pKnown: z.number().min(0).max(1),
    attempts: z.number().int().nonnegative(),
    correct: z.number().int().nonnegative(),
    /** Epoch milliseconds of the last observation, if the caller supplied one. */
    updatedAtMs: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((s) => s.correct <= s.attempts, {
    message: "correct cannot exceed attempts",
  });

export const masteryRecordSchema = z
  .object({
    version: z.literal(MASTERY_STORE_VERSION),
    concepts: z.record(slugSchema, conceptStateSchema),
  })
  .strict();

export type ConceptState = z.infer<typeof conceptStateSchema>;
export type MasteryRecord = z.infer<typeof masteryRecordSchema>;

export interface ObservationOptions {
  params?: BktParams;
  /** Stamped onto each touched concept; omit for timestamp-free records. */
  nowMs?: number;
}

export function emptyMasteryRecord(): MasteryRecord {
  return { version: MASTERY_STORE_VERSION, concepts: {} };
}

/**
 * Apply one observed answer to every concept the experiment exercises
 * (spec.concepts). Returns a new record; never mutates the input.
 *
 * Concept ids must be slugs (they come from validated specs); a malformed
 * id is a programmer error and throws.
 */
export function recordObservation(
  record: MasteryRecord,
  conceptIds: readonly string[],
  observedCorrect: boolean,
  options: ObservationOptions = {},
): MasteryRecord {
  const params = options.params ?? BKT_DEFAULTS;
  const concepts = { ...record.concepts };
  for (const conceptId of conceptIds) {
    if (!slugSchema.safeParse(conceptId).success) {
      throw new RangeError(`invalid concept id: ${JSON.stringify(conceptId)}`);
    }
    const previous = concepts[conceptId];
    const pKnown = previous?.pKnown ?? initialMastery(params);
    concepts[conceptId] = {
      pKnown: updateMastery(pKnown, observedCorrect, params),
      attempts: (previous?.attempts ?? 0) + 1,
      correct: (previous?.correct ?? 0) + (observedCorrect ? 1 : 0),
      ...(options.nowMs !== undefined
        ? { updatedAtMs: options.nowMs }
        : previous?.updatedAtMs !== undefined
          ? { updatedAtMs: previous.updatedAtMs }
          : {}),
    };
  }
  return { version: MASTERY_STORE_VERSION, concepts };
}

/** P(known) for a concept, falling back to P(L0) for unseen concepts. */
export function getMastery(
  record: MasteryRecord,
  conceptId: string,
  params: BktParams = BKT_DEFAULTS,
): number {
  return record.concepts[conceptId]?.pKnown ?? initialMastery(params);
}

/** Concept ids at or above the mastery threshold, sorted alphabetically. */
export function masteredConcepts(
  record: MasteryRecord,
  threshold: number = MASTERY_THRESHOLD,
): string[] {
  return Object.entries(record.concepts)
    .filter(([, state]) => state !== undefined && state.pKnown >= threshold)
    .map(([conceptId]) => conceptId)
    .sort();
}

/**
 * The n seen concepts with the lowest mastery — what to practice next.
 * Deterministic: ascending pKnown, ties broken alphabetically.
 */
export function weakestConcepts(record: MasteryRecord, n: number): string[] {
  return Object.entries(record.concepts)
    .filter(
      (entry): entry is [string, ConceptState] => entry[1] !== undefined,
    )
    .sort(([idA, a], [idB, b]) => a.pKnown - b.pKnown || idA.localeCompare(idB))
    .slice(0, Math.max(0, n))
    .map(([conceptId]) => conceptId);
}

export function serializeMasteryRecord(record: MasteryRecord): string {
  return JSON.stringify(record);
}

/**
 * Total inverse of serializeMasteryRecord: any malformed, corrupt, or
 * wrong-version payload (e.g. hand-edited localStorage) yields a fresh
 * empty record. Never throws.
 */
export function deserializeMasteryRecord(
  raw: string | null | undefined,
): MasteryRecord {
  if (typeof raw !== "string" || raw.length === 0) return emptyMasteryRecord();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyMasteryRecord();
  }
  const result = masteryRecordSchema.safeParse(parsed);
  return result.success ? result.data : emptyMasteryRecord();
}
