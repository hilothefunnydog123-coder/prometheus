import type {
  ExperimentFamily,
  ExperimentSpec,
} from "@/lib/ai/contracts/experiment-spec";
import type { LearningIntent } from "@/lib/ai/contracts/learning-intent";
import { dropFixture } from "./drop";
import { pendulumFixture } from "./pendulum";
import { projectileFixture } from "./projectile";

/**
 * Bundled golden fixtures. Every fixture passes validateExperimentSpec
 * (asserted in tests) so the fallback path can never serve an invalid spec.
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
      "drop",
      "fall",
      "falling",
      "free",
      "tower",
      "gravity",
      "weight",
      "heavy",
      "mass",
      "galileo",
      "acceleration",
    ],
  },
  {
    spec: projectileFixture,
    keywords: [
      "projectile",
      "launch",
      "throw",
      "throwing",
      "angle",
      "range",
      "cannon",
      "kick",
      "trajectory",
      "basketball",
      "arc",
      "motion",
    ],
  },
  {
    spec: pendulumFixture,
    keywords: [
      "pendulum",
      "swing",
      "swinging",
      "period",
      "oscillate",
      "oscillation",
      "bob",
      "clock",
      "grandfather",
      "harmonic",
    ],
  },
];

export function getFixtureByFamily(family: ExperimentFamily): Fixture {
  const fixture = FIXTURES.find((f) => f.spec.family === family);
  // All families are covered by construction; keep the invariant loud.
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
  if (
    intent.family === "drop" ||
    intent.family === "projectile" ||
    intent.family === "pendulum"
  ) {
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
