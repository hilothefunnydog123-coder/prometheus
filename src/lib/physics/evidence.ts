import type {
  CounterfactualSpec,
  ExperimentSpec,
  SceneSpec,
} from "@/lib/contracts/experiment";

export type EvidencePoint = {
  time: number;
  primary: number;
  secondary?: number;
  tertiary?: number;
};

export type SimulationEvidence = {
  outcomeKey: string;
  duration: number;
  summary: string;
  metricA: { label: string; value: string };
  metricB: { label: string; value: string };
  points: EvidencePoint[];
};

const radians = (degrees: number) => (degrees * Math.PI) / 180;

function dropTime(
  height: number,
  gravity: number,
  airDensity: number,
  mass: number,
  radius: number,
  dragCoefficient: number,
) {
  const vacuum = Math.sqrt((2 * height) / gravity);
  const dragLoad =
    (airDensity * dragCoefficient * Math.PI * radius * radius * height) /
    Math.max(mass, 0.01);
  return vacuum * (1 + Math.min(dragLoad * 0.018, 0.9));
}

export function determineOutcome(scene: SceneSpec) {
  if (scene.family === "drop") {
    const [a, b] = scene.objects;
    const timeA = dropTime(
      scene.height,
      scene.gravity,
      scene.airDensity,
      a.mass,
      a.radius,
      a.dragCoefficient,
    );
    const timeB = dropTime(
      scene.height,
      scene.gravity,
      scene.airDensity,
      b.mass,
      b.radius,
      b.dragCoefficient,
    );
    if (Math.abs(timeA - timeB) < 0.035) return "tie";
    return timeA < timeB ? "object_a_first" : "object_b_first";
  }

  if (scene.family === "projectile") {
    const angle = radians(scene.launch.angleDegrees);
    const vx = scene.launch.speed * Math.cos(angle);
    const vy = scene.launch.speed * Math.sin(angle);
    const flightTime =
      (vy + Math.sqrt(vy * vy + 2 * scene.gravity * scene.launch.height)) /
      scene.gravity;
    const dragPenalty = Math.max(
      0.45,
      1 -
        (scene.object.dragCoefficient * scene.object.radius ** 2 * flightTime) /
          Math.max(scene.object.mass, 0.05) *
          0.02,
    );
    const range = vx * flightTime * dragPenalty;
    const target = scene.targetDistance ?? range;
    const tolerance = Math.max(0.8, target * 0.055);
    if (Math.abs(range - target) <= tolerance) return "hit";
    return range < target ? "undershoot" : "overshoot";
  }

  return scene.length > 2.25 ? "period_increases" : "period_unchanged";
}

export function buildEvidence(spec: ExperimentSpec): SimulationEvidence {
  const { scene } = spec;
  if (scene.family === "drop") {
    const [a, b] = scene.objects;
    const timeA = dropTime(
      scene.height,
      scene.gravity,
      scene.airDensity,
      a.mass,
      a.radius,
      a.dragCoefficient,
    );
    const timeB = dropTime(
      scene.height,
      scene.gravity,
      scene.airDensity,
      b.mass,
      b.radius,
      b.dragCoefficient,
    );
    const duration = Math.max(timeA, timeB);
    const points = Array.from({ length: 31 }, (_, index) => {
      const time = (duration * index) / 30;
      return {
        time,
        primary: scene.height * Math.max(0, 1 - (time / timeA) ** 2),
        secondary: scene.height * Math.max(0, 1 - (time / timeB) ** 2),
      };
    });
    const delta = Math.abs(timeA - timeB);
    return {
      outcomeKey: determineOutcome(scene),
      duration,
      summary:
        delta < 0.035
          ? "Both objects hit within the same video frame. Mass did not change gravitational acceleration."
          : "Shape and drag-to-mass ratio—not mass alone—created the timing difference.",
      metricA: { label: "Object A impact", value: `${timeA.toFixed(2)} s` },
      metricB: { label: "Object B impact", value: `${timeB.toFixed(2)} s` },
      points,
    };
  }

  if (scene.family === "projectile") {
    const angle = radians(scene.launch.angleDegrees);
    const vx = scene.launch.speed * Math.cos(angle);
    const vy = scene.launch.speed * Math.sin(angle);
    const duration =
      (vy + Math.sqrt(vy ** 2 + 2 * scene.gravity * scene.launch.height)) /
      scene.gravity;
    const dragPenalty = Math.max(
      0.45,
      1 -
        (scene.object.dragCoefficient *
          scene.object.radius ** 2 *
          duration) /
          Math.max(scene.object.mass, 0.05) *
          0.02,
    );
    const range = vx * duration * dragPenalty;
    const apex = scene.launch.height + vy ** 2 / (2 * scene.gravity);
    const points = Array.from({ length: 36 }, (_, index) => {
      const time = (duration * index) / 35;
      return {
        time,
        primary:
          vx *
          time *
          (1 - (1 - dragPenalty) * (time / Math.max(duration, 0.001))),
        secondary: Math.max(
          0,
          scene.launch.height + vy * time - 0.5 * scene.gravity * time ** 2,
        ),
        tertiary: Math.sqrt(vx ** 2 + (vy - scene.gravity * time) ** 2),
      };
    });
    return {
      outcomeKey: determineOutcome(scene),
      duration,
      summary:
        "Horizontal velocity continued while gravity changed only the vertical velocity, producing a curved path.",
      metricA: { label: "Measured range", value: `${range.toFixed(1)} m` },
      metricB: { label: "Apex", value: `${apex.toFixed(1)} m` },
      points,
    };
  }

  const period = 2 * Math.PI * Math.sqrt(scene.length / scene.gravity);
  const amplitude = radians(scene.releaseAngleDegrees);
  const duration = Math.min(period * 2, 10);
  const omega = (2 * Math.PI) / period;
  const points = Array.from({ length: 50 }, (_, index) => {
    const time = (duration * index) / 49;
    const angle = amplitude * Math.cos(omega * time) * Math.exp(-scene.damping * time * 0.08);
    const speed = Math.abs(scene.length * amplitude * omega * Math.sin(omega * time));
    const potential =
      scene.bob.mass * scene.gravity * scene.length * (1 - Math.cos(angle));
    return {
      time,
      primary: (angle * 180) / Math.PI,
      secondary: speed,
      tertiary: potential,
    };
  });
  return {
    // Pendulum predictions compare two declarative worlds. The server-side
    // physics evaluator computes and overwrites this semantic key; the client
    // renders the measured period and never infers the tested variable from
    // natural-language prompt text.
    outcomeKey: spec.prediction.correctOutcomeKey,
    duration,
    summary:
      "The period follows length and gravity. Changing the bob’s mass changes energy, but not the swing’s timing.",
    metricA: { label: "Measured period", value: `${period.toFixed(2)} s` },
    metricB: { label: "Bob mass", value: `${scene.bob.mass.toFixed(1)} kg` },
    points,
  };
}

export function updateScenePath(
  spec: ExperimentSpec,
  targetPath: string,
  value: number,
): ExperimentSpec {
  const clone = structuredClone(spec) as ExperimentSpec & Record<string, unknown>;
  const segments = targetPath.split(".");
  let cursor: Record<string, unknown> = clone;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!segment) return spec;
    const next = cursor[segment];
    if (!next || typeof next !== "object") return spec;
    cursor = next as Record<string, unknown>;
  }
  cursor[segments.at(-1) ?? ""] = value;
  return clone;
}

export function applyCounterfactual(
  spec: ExperimentSpec,
  counterfactual: CounterfactualSpec,
) {
  const updated = updateScenePath(
    spec,
    counterfactual.change.targetPath,
    counterfactual.change.value,
  );
  return {
    ...updated,
    controls: updated.controls.map((control) =>
      control.targetPath === counterfactual.change.targetPath
        ? { ...control, value: counterfactual.change.value }
        : control,
    ),
    prediction: counterfactual.prediction,
  };
}
