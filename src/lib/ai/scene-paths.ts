import type { SceneSpec } from "@/lib/contracts/experiment";
import type { ExperimentFamily } from "./text-rules";

/**
 * Allowlisted targetPath values — the only scene properties that controls,
 * counterfactual changes, and prediction testChange may address — plus the
 * numeric bounds each patched value must respect (mirroring the contract's
 * scene schemas; the contract remains authoritative via re-parsing).
 */

export interface PathBounds {
  min: number;
  max: number;
}

const BODY_BOUNDS = {
  mass: { min: 0.05, max: 100 },
  radius: { min: 0.05, max: 2 },
  dragCoefficient: { min: 0, max: 2.5 },
} as const;

export const SCENE_PATH_BOUNDS: Record<
  ExperimentFamily,
  Readonly<Record<string, PathBounds>>
> = {
  drop: {
    "scene.gravity": { min: 0.5, max: 25 },
    "scene.height": { min: 0.5, max: 20 },
    "scene.airDensity": { min: 0, max: 2 },
    "scene.objects.0.mass": BODY_BOUNDS.mass,
    "scene.objects.1.mass": BODY_BOUNDS.mass,
    "scene.objects.0.radius": BODY_BOUNDS.radius,
    "scene.objects.1.radius": BODY_BOUNDS.radius,
    "scene.objects.0.dragCoefficient": BODY_BOUNDS.dragCoefficient,
    "scene.objects.1.dragCoefficient": BODY_BOUNDS.dragCoefficient,
  },
  projectile: {
    "scene.gravity": { min: 0.5, max: 25 },
    "scene.launch.speed": { min: 1, max: 40 },
    "scene.launch.angleDegrees": { min: 1, max: 80 },
    "scene.launch.height": { min: 0, max: 20 },
    "scene.targetDistance": { min: 1, max: 100 },
    "scene.object.mass": BODY_BOUNDS.mass,
    "scene.object.radius": BODY_BOUNDS.radius,
    "scene.object.dragCoefficient": BODY_BOUNDS.dragCoefficient,
  },
  pendulum: {
    "scene.gravity": { min: 0.5, max: 25 },
    "scene.length": { min: 0.25, max: 10 },
    "scene.releaseAngleDegrees": { min: 1, max: 80 },
    "scene.damping": { min: 0, max: 2 },
    "scene.bob.mass": BODY_BOUNDS.mass,
    "scene.bob.radius": BODY_BOUNDS.radius,
    "scene.bob.dragCoefficient": BODY_BOUNDS.dragCoefficient,
  },
};

export function isAllowlistedPath(
  family: ExperimentFamily,
  targetPath: string,
): boolean {
  return targetPath in SCENE_PATH_BOUNDS[family];
}

export function pathBounds(
  family: ExperimentFamily,
  targetPath: string,
): PathBounds | null {
  return SCENE_PATH_BOUNDS[family][targetPath] ?? null;
}

function segmentsOf(targetPath: string): string[] {
  // Paths are of the form "scene.a.b"; the leading "scene" refers to the
  // scene object itself.
  return targetPath.split(".").slice(1);
}

/** Read the current numeric value at an allowlisted path (null if absent). */
export function getSceneValue(
  scene: SceneSpec,
  targetPath: string,
): number | null {
  let cursor: unknown = scene;
  for (const segment of segmentsOf(targetPath)) {
    if (cursor === null || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === "number" && Number.isFinite(cursor) ? cursor : null;
}

/**
 * Return a deep-cloned scene with the value at an allowlisted path replaced.
 * Throws if the path is not allowlisted for the scene's family or does not
 * resolve to an existing numeric leaf — callers validate first.
 */
export function applySceneChange(
  scene: SceneSpec,
  targetPath: string,
  value: number,
): SceneSpec {
  if (!isAllowlistedPath(scene.family, targetPath)) {
    throw new Error(`targetPath "${targetPath}" is not allowlisted for ${scene.family}`);
  }
  if (getSceneValue(scene, targetPath) === null) {
    throw new Error(`targetPath "${targetPath}" does not resolve to a number`);
  }
  const clone = structuredClone(scene) as unknown as Record<string, unknown>;
  const segments = segmentsOf(targetPath);
  let cursor: Record<string, unknown> = clone;
  for (const segment of segments.slice(0, -1)) {
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]!] = value;
  return clone as unknown as SceneSpec;
}
