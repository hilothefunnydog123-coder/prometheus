import type { ExperimentSpec } from "@/lib/contracts/experiment";
import type { LearningIntent } from "@/lib/ai/contracts/learning-intent";
import type { ExperimentFamily } from "@/lib/ai/text-rules";
import { dropFixture } from "./drop";
import { pendulumFixture } from "./pendulum";
import { projectileFixture } from "./projectile";

/**
 * Bundled golden fixtures on the renderer contract. Every fixture passes
 * validateExperimentSpec with its declared correctOutcomeKey values equal to
 * the server-computed ones (asserted in tests), so the fallback path can
 * never serve an invalid or self-contradictory spec.
 */

export interface Fixture {
  spec: ExperimentSpec;
  /** Lowercase keywords used for closest-match scoring. */
  keywords: readonly string[];
}

/**
 * Order matters: it is the deterministic tie-break for closest-match, so
 * `drop` is the ultimate default when nothing matches.
 */
export const FIXTURES: readonly Fixture[] = [
  {
    spec: dropFixture,
    keywords: [
      "drop", "fall", "falling", "free", "tower", "gravity", "weight",
      "heavy", "mass", "galileo", "acceleration",
    ],
  },
  {
    spec: projectileFixture,
    keywords: [
      "projectile", "launch", "throw", "throwing", "angle", "range",
      "cannon", "kick", "trajectory", "basketball", "arc", "motion",
    ],
  },
  {
    spec: pendulumFixture,
    keywords: [
      "pendulum", "swing", "swinging", "period", "oscillate", "oscillation",
      "bob", "clock", "grandfather", "harmonic",
    ],
  },
];

export function getFixtureByFamily(family: ExperimentFamily): Fixture {
  const fixture = FIXTURES.find((f) => f.spec.scene.family === family);
  if (!fixture) throw new Error(`no fixture for family ${family}`);
  return fixture;
}

function tokenize(intent: LearningIntent): string[] {
  const conceptWords = intent.concepts.flatMap((c) => c.split(/[-_]/));
  return [
    ...intent.topic.toLowerCase().split(/[^a-z0-9]+/),
    ...conceptWords,
  ].filter((t) => t.length > 1);
}

/**
 * Deterministic closest-fixture selection:
 * 1. An explicit family match always wins.
 * 2. Otherwise keyword overlap against topic + concepts, ties broken by
 *    fixture declaration order (drop first).
 */
export function closestFixture(intent: LearningIntent): Fixture {
  if (intent.family !== "unknown") {
    return getFixtureByFamily(intent.family);
  }
  const tokens = tokenize(intent);
  let best = FIXTURES[0]!;
  let bestScore = -1;
  for (const fixture of FIXTURES) {
    const score = fixture.keywords.reduce(
      (sum, keyword) => sum + (tokens.includes(keyword) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      best = fixture;
      bestScore = score;
    }
  }
  return best;
}

export { dropFixture, pendulumFixture, projectileFixture };
