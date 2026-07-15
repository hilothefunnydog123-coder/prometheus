import {
  initialMastery,
  updateMastery,
} from "@/lib/mastery/bkt";

export type MasteryProfile = {
  version: 1;
  misconceptions: Record<
    string,
    { probability: number; attempts: number; lastSeen: string }
  >;
};

const STORAGE_KEY = "counterfactual-lab.mastery.v1";

const emptyProfile = (): MasteryProfile => ({
  version: 1,
  misconceptions: {},
});

function readProfile(): MasteryProfile {
  if (typeof window === "undefined") return emptyProfile();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProfile();
    const candidate = JSON.parse(raw) as Partial<MasteryProfile>;
    if (candidate.version !== 1 || !candidate.misconceptions) {
      return emptyProfile();
    }
    return {
      version: 1,
      misconceptions: candidate.misconceptions,
    };
  } catch {
    return emptyProfile();
  }
}

function writeProfile(profile: MasteryProfile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage may be blocked or full; the learning flow should still finish.
  }
}

export function masteryProbability(misconceptionId: string): number {
  return (
    readProfile().misconceptions[misconceptionId]?.probability ??
    initialMastery()
  );
}

export function recordMasteryObservation(
  misconceptionId: string,
  observedCorrect: boolean,
): number {
  const profile = readProfile();
  const current = profile.misconceptions[misconceptionId];
  const probability = updateMastery(
    current?.probability ?? initialMastery(),
    observedCorrect,
  );
  profile.misconceptions[misconceptionId] = {
    probability,
    attempts: (current?.attempts ?? 0) + 1,
    lastSeen: new Date().toISOString(),
  };
  writeProfile(profile);
  return probability;
}
