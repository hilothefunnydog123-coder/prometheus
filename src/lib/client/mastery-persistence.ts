import {
  deserializeMasteryRecord,
  serializeMasteryRecord,
  type MasteryRecord,
} from "@/lib/mastery/store";

/**
 * localStorage adapter for the mastery record. All the interesting logic
 * (versioning, corruption tolerance) lives in the pure store module; this
 * file only guards against SSR and quota/security errors.
 */

const STORAGE_KEY = "counterfactual-lab:mastery";

export function loadMasteryRecord(): MasteryRecord {
  if (typeof window === "undefined") return deserializeMasteryRecord(null);
  try {
    return deserializeMasteryRecord(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Storage can throw in private browsing / blocked-cookie contexts.
    return deserializeMasteryRecord(null);
  }
}

export function saveMasteryRecord(record: MasteryRecord): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeMasteryRecord(record));
  } catch {
    // Best-effort persistence; the in-memory record still works.
  }
}

export function clearMasteryRecord(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
