import { z } from "zod";
import { EXPERIMENT_FAMILIES, safeText, slugSchema } from "./experiment-spec";

/**
 * PUBLIC CONTRACT — LearningIntent
 *
 * The routing result of analyzeInput(): what the learner wants to study,
 * mapped onto an experiment family. `family: "unknown"` is a valid result
 * and downstream code must handle it (the compiler falls back to the
 * closest bundled fixture).
 */

export const INTENT_FAMILIES = [...EXPERIMENT_FAMILIES, "unknown"] as const;
export type IntentFamily = (typeof INTENT_FAMILIES)[number];

export const DIFFICULTIES = ["intro", "standard", "advanced"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const learningIntentSchema = z
  .object({
    /** Short human-readable restatement of the topic. Plain text only. */
    topic: safeText(3, 120),
    family: z.enum(INTENT_FAMILIES),
    concepts: z.array(slugSchema).max(5),
    difficulty: z.enum(DIFFICULTIES),
    /** Router confidence in [0, 1]. Heuristic routing reports low values. */
    confidence: z.number().min(0).max(1),
    /** Whether an image contributed to this intent. Set server-side. */
    usedImage: z.boolean(),
  })
  .strict();

export type LearningIntent = z.infer<typeof learningIntentSchema>;
