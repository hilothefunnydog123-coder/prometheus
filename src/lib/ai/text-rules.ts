import { z } from "zod";

/**
 * Internal text-safety rules shared by the compiler pipeline. The public
 * spec contract lives in src/lib/contracts/experiment.ts; these helpers
 * enforce the additional server-side guarantee that no spec string can
 * carry executable code, markup, shader source, or file paths.
 */

export const EXPERIMENT_FAMILIES = ["drop", "projectile", "pendulum"] as const;
export type ExperimentFamily = (typeof EXPERIMENT_FAMILIES)[number];

const CONTROL_CHARS =
  /[\u0000-\u001F\u007F\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/;

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, "must be a short lowercase slug");

/** Plain-text field: trimmed, length-bounded, free of unsafe content. */
export const safeText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => findForbiddenContent(value) === null, {
      message: "must be plain text without code, markup, or paths",
    });

const FORBIDDEN_CONTENT: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: CONTROL_CHARS, reason: "control characters" },
  { pattern: /[<>]/, reason: "markup or angle brackets" },
  { pattern: /`|\$\{/, reason: "code template syntax" },
  { pattern: /\b(?:eval|function|require|exec|import)\s*\(/i, reason: "executable code" },
  { pattern: /javascript\s*:/i, reason: "script URL" },
  {
    pattern:
      /\bignore (?:all |any )?(?:previous|prior|system|developer) instructions?\b/i,
    reason: "prompt-injection instructions",
  },
  {
    pattern:
      /\b(?:reveal|show|print|repeat|expose)\b.{0,40}\b(?:system prompt|developer message|api key|secret|credentials?)\b/i,
    reason: "secret-extraction instructions",
  },
  {
    pattern: /\b(?:write|output|execute|run)\s+(?:javascript|python|shell|code)\b/i,
    reason: "code-generation instructions",
  },
  {
    pattern: /BEGIN_UNTRUSTED_DATA|END_UNTRUSTED_DATA/i,
    reason: "prompt boundary text",
  },
  { pattern: /\bgl_[A-Za-z]+|#version\s+\d|void\s+main\s*\(/, reason: "shader source" },
  { pattern: /(?:\.\.\/|\/(?:usr|etc|var|home|tmp|opt)\/|[A-Za-z]:\\)/, reason: "file path" },
];

/**
 * Returns the reason a string is unsafe, or null when it is plain text.
 * Hex colors ("#ff8a3d") and units ("m/s²", "°") pass.
 */
export function findForbiddenContent(value: string): string | null {
  for (const rule of FORBIDDEN_CONTENT) {
    if (rule.pattern.test(value)) return rule.reason;
  }
  return null;
}

/**
 * Recursively scan every string field of a parsed spec and report concise
 * errors ("path: contains <reason>"). Used after Zod parsing as defense in
 * depth for fields whose schema does not already restrict content.
 */
export function scanStringsForForbiddenContent(
  value: unknown,
  path = "",
): string[] {
  if (typeof value === "string") {
    const reason = findForbiddenContent(value);
    return reason === null ? [] : [`${path || "(root)"}: contains ${reason}`];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      scanStringsForForbiddenContent(item, `${path}[${index}]`),
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      scanStringsForForbiddenContent(child, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

/** Identifier rule for spec/choice/control ids coming from the model. */
export const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
