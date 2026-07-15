import { getFeatherlessConfig } from "./config";
import {
  learningIntentSchema,
  type Difficulty,
  type IntentFamily,
  type LearningIntent,
} from "./contracts/learning-intent";
import {
  chatCompletion,
  type ChatContentPart,
  type ChatMessage,
} from "./featherless-client";
import {
  ANALYZE_SYSTEM_PROMPT,
  REPORT_LEARNING_INTENT_TOOL,
  sanitizeUserText,
  wrapUntrusted,
} from "./prompts";

/**
 * analyzeInput: untrusted learner text (and optionally an image, e.g. a
 * photo of a homework problem) -> validated LearningIntent.
 *
 * Totality guarantee: this function never throws for well-typed inputs.
 * Missing credentials, provider failures, timeouts, and unusable model
 * output all deterministically degrade to the keyword heuristic, so the
 * compiler downstream always has an intent to work with.
 */

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export interface ImageInput {
  mimeType: SupportedImageMimeType;
  /** Raw base64 (no data: prefix). */
  base64Data: string;
}

export interface AnalyzeDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

const FAMILY_KEYWORDS: ReadonlyArray<{
  family: Exclude<IntentFamily, "unknown">;
  words: readonly string[];
  concepts: readonly string[];
}> = [
  {
    family: "drop",
    words: ["drop", "dropped", "fall", "falling", "free fall", "freefall", "tower", "galileo", "feather"],
    concepts: ["free-fall", "acceleration"],
  },
  {
    family: "projectile",
    words: ["projectile", "launch", "throw", "thrown", "cannon", "kick", "trajectory", "range", "basketball", "arrow"],
    concepts: ["projectile-motion", "launch-angle"],
  },
  {
    family: "pendulum",
    words: ["pendulum", "swing", "swinging", "oscillat", "period", "bob", "grandfather clock"],
    concepts: ["pendulum-period", "oscillation"],
  },
];

function heuristicDifficulty(text: string): Difficulty {
  const lower = text.toLowerCase();
  if (/\b(beginner|simple|basic|kid|child|eli5|easy)\b/.test(lower)) {
    return "intro";
  }
  if (/\b(advanced|derive|derivation|calculus|proof|rigorous)\b/.test(lower)) {
    return "advanced";
  }
  return "standard";
}

/**
 * Deterministic keyword router. Also the documented behavior for prompt
 * injection attempts: adversarial text almost never names a physics family,
 * so it routes to "unknown" and the compiler serves a bundled fixture.
 */
export function heuristicIntent(
  rawText: string,
  usedImage: boolean,
): LearningIntent {
  const text = sanitizeUserText(rawText);
  const lower = text.toLowerCase();

  let family: IntentFamily = "unknown";
  let concepts: string[] = [];
  let bestHits = 0;
  for (const candidate of FAMILY_KEYWORDS) {
    const hits = candidate.words.reduce(
      (sum, word) => sum + (lower.includes(word) ? 1 : 0),
      0,
    );
    if (hits > bestHits) {
      family = candidate.family;
      concepts = [...candidate.concepts];
      bestHits = hits;
    }
  }

  // Topic is derived from learner text but must satisfy the contract's
  // plain-text rules, so reuse a safe slice and strip angle brackets.
  const topicSource = text.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
  const topic =
    topicSource.length >= 3 ? topicSource.slice(0, 120) : "general physics";

  return learningIntentSchema.parse({
    topic,
    family,
    concepts,
    difficulty: heuristicDifficulty(text),
    confidence: family === "unknown" ? 0.1 : 0.4,
    usedImage,
  });
}

function buildUserMessage(text: string, image?: ImageInput): ChatMessage {
  const wrapped = wrapUntrusted(text);
  if (!image) {
    return { role: "user", content: wrapped };
  }
  const parts: ChatContentPart[] = [
    { type: "text", text: wrapped },
    {
      type: "image_url",
      image_url: {
        url: `data:${image.mimeType};base64,${image.base64Data}`,
      },
    },
  ];
  return { role: "user", content: parts };
}

export async function analyzeInput(
  text: string,
  image?: ImageInput,
  deps: AnalyzeDeps = {},
): Promise<LearningIntent> {
  const usedImage = image !== undefined;
  const config = getFeatherlessConfig(deps.env);
  if (!config) {
    return heuristicIntent(text, usedImage);
  }

  try {
    const result = await chatCompletion(
      config,
      {
        model: usedImage ? config.visionModel : config.textModel,
        messages: [
          { role: "system", content: ANALYZE_SYSTEM_PROMPT },
          buildUserMessage(text, image),
        ],
        tool: REPORT_LEARNING_INTENT_TOOL,
        maxTokens: 400,
      },
      deps.fetchImpl,
    );
    if (result.toolArguments === null) {
      return heuristicIntent(text, usedImage);
    }
    const candidate: unknown = JSON.parse(result.toolArguments);
    const parsed = learningIntentSchema.safeParse({
      ...(typeof candidate === "object" && candidate !== null
        ? candidate
        : {}),
      // usedImage is server truth, never model output.
      usedImage,
    });
    return parsed.success ? parsed.data : heuristicIntent(text, usedImage);
  } catch {
    // Timeout, HTTP error, or malformed JSON — degrade deterministically.
    return heuristicIntent(text, usedImage);
  }
}
