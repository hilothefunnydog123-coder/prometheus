import { z } from "zod";

export const gradeBandSchema = z.enum(["8-10", "11-12"]);

const boundedNumber = (minimum: number, maximum: number) =>
  z.number().finite().min(minimum).max(maximum);

const bodySchema = z.object({
  id: z.string().min(1).max(40),
  mass: boundedNumber(0.05, 100),
  radius: boundedNumber(0.05, 2),
  dragCoefficient: boundedNumber(0, 2.5),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const dropSceneSchema = z.object({
  family: z.literal("drop"),
  gravity: boundedNumber(0.5, 25),
  height: boundedNumber(0.5, 20),
  airDensity: boundedNumber(0, 2),
  objects: z.tuple([bodySchema, bodySchema]),
});

export const projectileSceneSchema = z.object({
  family: z.literal("projectile"),
  gravity: boundedNumber(0.5, 25),
  launch: z.object({
    speed: boundedNumber(1, 40),
    angleDegrees: boundedNumber(1, 80),
    height: boundedNumber(0, 20),
  }),
  object: bodySchema,
  targetDistance: boundedNumber(1, 100).optional(),
});

export const pendulumSceneSchema = z.object({
  family: z.literal("pendulum"),
  gravity: boundedNumber(0.5, 25),
  length: boundedNumber(0.25, 10),
  releaseAngleDegrees: boundedNumber(1, 80),
  damping: boundedNumber(0, 2),
  bob: bodySchema,
});

export const sceneSchema = z.discriminatedUnion("family", [
  dropSceneSchema,
  projectileSceneSchema,
  pendulumSceneSchema,
]);

export const controlSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
  unit: z.string().max(12),
  min: z.number().finite(),
  max: z.number().finite(),
  step: z.number().finite().positive(),
  value: z.number().finite(),
  targetPath: z.string().regex(/^scene\.[a-zA-Z0-9.]+$/),
});

export const measurementSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
  unit: z.string().max(16),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const predictionChoiceSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(140),
  outcomeKey: z.string().min(1).max(60),
});

export const predictionSchema = z.object({
  prompt: z.string().min(1).max(300),
  reasoningPrompt: z.string().min(1).max(300),
  choices: z.array(predictionChoiceSchema).min(2).max(4),
  correctOutcomeKey: z.string().min(1).max(60),
  /**
   * Declarative description of the controlled comparison this prediction
   * tests, e.g. "what happens to the period if scene.bob.mass becomes 12?".
   * Required for pendulum base predictions (period questions compare two
   * worlds and cannot be evaluated from prose); optional elsewhere. The
   * server uses this — never the prompt text — to compute correctOutcomeKey.
   */
  testChange: z
    .object({
      targetPath: z.string().regex(/^scene\.[a-zA-Z0-9.]+$/),
      value: z.number().finite(),
    })
    .optional(),
});

export const misconceptionSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(400),
  explanationRubric: z.array(z.string().min(1).max(180)).min(1).max(5),
});

export const counterfactualSchema = z.object({
  id: z.string().min(1).max(60),
  title: z.string().min(1).max(120),
  prompt: z.string().min(1).max(300),
  change: z.object({
    targetPath: z.string().regex(/^scene\.[a-zA-Z0-9.]+$/),
    value: z.number().finite(),
  }),
  prediction: predictionSchema,
});

export const experimentSpecSchema = z.object({
  version: z.literal("1.0"),
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(140),
  gradeBand: gradeBandSchema,
  objective: z.string().min(1).max(300),
  sourceSummary: z.string().min(1).max(500),
  scene: sceneSchema,
  controls: z.array(controlSchema).max(6),
  measurements: z.array(measurementSchema).min(1).max(6),
  prediction: predictionSchema,
  misconception: misconceptionSchema,
  counterfactuals: z.array(counterfactualSchema).min(1).max(3),
});

export type GradeBand = z.infer<typeof gradeBandSchema>;
export type DropScene = z.infer<typeof dropSceneSchema>;
export type ProjectileScene = z.infer<typeof projectileSceneSchema>;
export type PendulumScene = z.infer<typeof pendulumSceneSchema>;
export type SceneSpec = z.infer<typeof sceneSchema>;
export type ControlSpec = z.infer<typeof controlSchema>;
export type MeasurementSpec = z.infer<typeof measurementSchema>;
export type PredictionSpec = z.infer<typeof predictionSchema>;
export type MisconceptionSpec = z.infer<typeof misconceptionSchema>;
export type CounterfactualSpec = z.infer<typeof counterfactualSchema>;
export type ExperimentSpec = z.infer<typeof experimentSpecSchema>;

export type CompileResponse = {
  spec: ExperimentSpec;
  warnings: string[];
  provenance: {
    source: "generated" | "validated-example";
    model?: string;
    generatedAt: string;
  };
};

export type EvaluationResponse = {
  score: number;
  criteria: Record<string, boolean>;
  feedback: string;
  hint: string;
};
