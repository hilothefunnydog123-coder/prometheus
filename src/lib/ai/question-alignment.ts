import type { ExperimentSpec } from "@/lib/contracts/experiment";
import { sanitizeUserText } from "./prompts";

const QUESTION_STOP_WORDS = new Set([
  "about",
  "affect",
  "and",
  "are",
  "ball",
  "diagram",
  "does",
  "drop",
  "explain",
  "fall",
  "falling",
  "for",
  "from",
  "happen",
  "happens",
  "how",
  "image",
  "into",
  "learn",
  "me",
  "object",
  "objects",
  "pendulum",
  "projectile",
  "photo",
  "please",
  "show",
  "that",
  "teach",
  "the",
  "their",
  "this",
  "through",
  "understand",
  "what",
  "when",
  "where",
  "which",
  "why",
  "with",
  "would",
]);

function learnerFacingText(spec: ExperimentSpec): string {
  return [
    spec.title,
    spec.objective,
    spec.sourceSummary,
    spec.prediction.prompt,
    spec.prediction.reasoningPrompt,
    spec.misconception.title,
    spec.misconception.description,
    ...spec.misconception.explanationRubric,
    ...spec.measurements.map((measurement) => measurement.label),
    ...spec.controls.map((control) => control.label),
    ...spec.counterfactuals.flatMap((counterfactual) => [
      counterfactual.title,
      counterfactual.prompt,
      counterfactual.prediction.prompt,
      counterfactual.prediction.reasoningPrompt,
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

function hasChangePath(spec: ExperimentSpec, targetPath: string): boolean {
  return (
    spec.controls.some((control) => control.targetPath === targetPath) ||
    spec.prediction.testChange?.targetPath === targetPath ||
    spec.counterfactuals.some(
      (counterfactual) =>
        counterfactual.change.targetPath === targetPath ||
        counterfactual.prediction.testChange?.targetPath === targetPath,
    )
  );
}

/**
 * Question-specific semantic checks applied after structural and physics
 * validation. They prevent a valid generic family fixture from being passed
 * off as an answer to a more specific learner question.
 */
export function questionAlignmentErrors(
  spec: ExperimentSpec,
  sourceQuestion: string,
): string[] {
  const question = sanitizeUserText(sourceQuestion).toLowerCase();
  const text = learnerFacingText(spec);
  const errors: string[] = [];

  const asksTerminalVelocity = /\bterminal velocity\b/.test(question);
  const asksAboutDrag =
    asksTerminalVelocity || /\b(?:air resistance|aerodynamic drag|drag force)\b/.test(question);

  if (asksTerminalVelocity) {
    if (spec.scene.family !== "drop" && spec.scene.family !== "sandbox") {
      errors.push("terminal-velocity questions require a drop or sandbox scene");
    }
    if (!/\bterminal velocity\b/.test(text)) {
      errors.push(
        "learner-facing text must explicitly explain terminal velocity",
      );
    }
    if (!spec.measurements.some((measurement) => /speed|velocity/i.test(measurement.label))) {
      errors.push(
        "terminal-velocity experiments must measure speed or velocity",
      );
    }
  }

  if (asksAboutDrag) {
    if (spec.scene.family === "sandbox") {
      if (spec.scene.airDensity <= 0) {
        errors.push("air-resistance questions require non-zero air density");
      }
      if (!spec.scene.bodies.some((body) => body.dragCoefficient > 0)) {
        errors.push(
          "air-resistance questions require a body with non-zero drag",
        );
      }
    } else if (spec.scene.family === "drop") {
      if (spec.scene.airDensity <= 0) {
        errors.push("air-resistance questions require non-zero air density");
      }
      if (
        !spec.scene.objects.some(
          (object) => object.dragCoefficient > 0 && object.radius > 0,
        )
      ) {
        errors.push(
          "air-resistance questions require an object with non-zero drag",
        );
      }
      if (
        !hasChangePath(spec, "scene.airDensity") &&
        !hasChangePath(spec, "scene.objects.0.dragCoefficient") &&
        !hasChangePath(spec, "scene.objects.1.dragCoefficient") &&
        !hasChangePath(spec, "scene.objects.0.radius") &&
        !hasChangePath(spec, "scene.objects.1.radius")
      ) {
        errors.push(
          "air-resistance questions must expose or change an air/drag variable",
        );
      }
    } else if (spec.scene.family === "projectile") {
      if (spec.scene.object.dragCoefficient <= 0) {
        errors.push("air-resistance questions require non-zero projectile drag");
      }
    }
  }

  if (/\b(?:launch|projection) angle\b|\bangle.*(?:range|distance)\b/.test(question)) {
    if (spec.scene.family === "projectile") {
      if (!hasChangePath(spec, "scene.launch.angleDegrees")) {
        errors.push(
          "launch-angle questions must expose or change the launch angle",
        );
      }
    } else if (spec.scene.family !== "sandbox") {
      // Sandbox encodes an angle through the launch velocity vector, so it is
      // allowed to answer angle questions without a dedicated angle field.
      errors.push("launch-angle questions require a projectile or sandbox scene");
    }
  }

  if (
    /\b(?:string|rope|pendulum) length\b|\bmetronome\b/.test(question)
  ) {
    if (spec.scene.family === "pendulum") {
      if (!hasChangePath(spec, "scene.length")) {
        errors.push(
          "pendulum-length questions must expose or change string length",
        );
      }
    } else if (spec.scene.family !== "sandbox") {
      errors.push("pendulum-length questions require a pendulum or sandbox scene");
    }
  }

  const topicTokens = Array.from(
    new Set(question.match(/[a-z0-9]+/g) ?? []),
  ).filter(
    (token) => token.length >= 4 && !QUESTION_STOP_WORDS.has(token),
  ).map((token) =>
    token.length > 5 && token.endsWith("s") ? token.slice(0, -1) : token,
  );
  const matchingTokens = topicTokens.filter((token) =>
    matchesTopicToken(text, token),
  );
  const requiredMatches = Math.min(2, topicTokens.length);
  if (requiredMatches > 0 && matchingTokens.length < requiredMatches) {
    // The repair round can only fix what it can see: name the exact terms.
    // (These are single sanitized words from the learner's question — the
    // model already has the full question; logs keep only the code prefix.)
    const missing = topicTokens.filter(
      (token) => !matchingTokens.includes(token),
    );
    errors.push(
      `alignment.topic-terms: learner-facing text (title, objective, prediction, misconception) must reuse the question's key words; missing: ${missing.join(", ")}`,
    );
  }

  return errors;
}

/**
 * A topic token counts as covered when the text contains it verbatim or
 * shares its stem — "heavier" must accept "heavy"/"heaviest", "faster" must
 * accept "fast". Deterministic suffix stripping only; no fuzzy matching.
 */
const STEM_SUFFIXES = ["iest", "ier", "est", "ing", "ed", "er", "ly", "s"];

function stemToken(token: string): string {
  for (const suffix of STEM_SUFFIXES) {
    if (token.length - suffix.length >= 4 && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

function matchesTopicToken(text: string, token: string): boolean {
  if (text.includes(token)) return true;
  const stem = stemToken(token);
  return stem !== token && text.includes(stem);
}
