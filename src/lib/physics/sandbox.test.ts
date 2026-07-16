import { describe, expect, it } from "vitest";
import type { SandboxScene, SandboxOutcomeRule } from "@/lib/contracts/experiment";
import {
  buildSandboxEvidence,
  sandboxCompareBodies,
  sandboxCompareChange,
  sandboxMetricValue,
  simulateSandbox,
} from "./sandbox";

function body(
  id: string,
  overrides: Partial<SandboxScene["bodies"][number]> = {},
): SandboxScene["bodies"][number] {
  return {
    id,
    label: id,
    mass: 1,
    radius: 0.5,
    dragCoefficient: 0,
    fixed: false,
    color: "#ff8a3d",
    position: { x: 0, y: 10 },
    velocity: { x: 0, y: 0 },
    ...overrides,
  };
}

function scene(overrides: Partial<SandboxScene> & { outcomeRule: SandboxOutcomeRule }): SandboxScene {
  return {
    family: "sandbox",
    gravity: 10,
    airDensity: 0,
    restitution: 1,
    hasFloor: false,
    centralGravity: 0,
    collisions: false,
    duration: 2,
    bodies: [body("a")],
    springs: [],
    ...overrides,
  };
}

describe("simulateSandbox free fall", () => {
  it("matches analytic constant-acceleration motion", () => {
    const s = scene({
      duration: 1,
      bodies: [body("a", { position: { x: 0, y: 10 } })],
      outcomeRule: { kind: "compare_change", metric: "final_height", body: "a", tolerance: 0.01 },
    });
    const traj = simulateSandbox(s);
    // y(1) = 10 - 0.5*g*t^2 = 5, within symplectic-Euler O(dt) error.
    const finalHeight = sandboxMetricValue(s, traj, "a", "final_height");
    expect(finalHeight).toBeCloseTo(5, 1);
    const finalSpeed = sandboxMetricValue(s, traj, "a", "final_speed");
    expect(finalSpeed).toBeCloseTo(10, 1); // v = g*t
  });

  it("computes time to floor from the drop distance", () => {
    const s = scene({
      gravity: 10,
      hasFloor: true,
      duration: 3,
      bodies: [body("a", { radius: 0.5, position: { x: 0, y: 20 } })],
      outcomeRule: { kind: "compare_change", metric: "time_to_floor", body: "a", tolerance: 0.01 },
    });
    const traj = simulateSandbox(s);
    // Falls from center y=20 to contact at y=radius=0.5 → 19.5 m. t=sqrt(2*19.5/10).
    const expected = Math.sqrt((2 * 19.5) / 10);
    const time = sandboxMetricValue(s, traj, "a", "time_to_floor");
    expect(time).toBeCloseTo(expected, 1);
  });
});

describe("simulateSandbox springs", () => {
  it("reproduces the simple-harmonic period 2π√(m/k)", () => {
    const k = 100;
    const m = 1;
    const s = scene({
      gravity: 0,
      duration: 3,
      // Small oscillation about the equilibrium at x = restLength = 5, well
      // clear of the anchor, so the motion is clean linear SHM.
      bodies: [body("a", { mass: m, position: { x: 5.4, y: 0 }, velocity: { x: 0, y: 0 } })],
      springs: [
        {
          id: "spring",
          bodyA: "a",
          bodyB: null,
          anchor: { x: 0, y: 0 },
          stiffness: k,
          restLength: 5,
          damping: 0,
        },
      ],
      outcomeRule: { kind: "compare_change", metric: "period", body: "a", tolerance: 0.01 },
    });
    const traj = simulateSandbox(s);
    const period = sandboxMetricValue(s, traj, "a", "period");
    const expected = 2 * Math.PI * Math.sqrt(m / k);
    expect(period).toBeGreaterThan(expected * 0.95);
    expect(period).toBeLessThan(expected * 1.05);
  });
});

describe("simulateSandbox central gravity", () => {
  it("holds a circular orbit at the correct speed", () => {
    const mu = 100;
    const r = 5;
    const v = Math.sqrt(mu / r);
    const s = scene({
      gravity: 0,
      centralGravity: mu,
      duration: 2,
      bodies: [
        body("a", {
          mass: 1,
          position: { x: r, y: 0 },
          velocity: { x: 0, y: v },
        }),
      ],
      outcomeRule: { kind: "compare_change", metric: "final_height", body: "a", tolerance: 0.01 },
    });
    const traj = simulateSandbox(s);
    const radii = traj.frames.map((frame) =>
      Math.hypot(frame.bodies[0]!.x, frame.bodies[0]!.y),
    );
    const maxRadius = Math.max(...radii);
    const minRadius = Math.min(...radii);
    expect(maxRadius).toBeLessThan(r * 1.05);
    expect(minRadius).toBeGreaterThan(r * 0.95);
  });
});

describe("simulateSandbox collisions", () => {
  it("exchanges velocities in an equal-mass elastic head-on collision", () => {
    const s = scene({
      gravity: 0,
      collisions: true,
      restitution: 1,
      duration: 3,
      bodies: [
        body("a", { position: { x: -3, y: 5 }, velocity: { x: 2, y: 0 } }),
        body("b", { position: { x: 3, y: 5 }, velocity: { x: -2, y: 0 } }),
      ],
      outcomeRule: {
        kind: "compare_bodies",
        metric: "final_x",
        bodyA: "a",
        bodyB: "b",
        comparator: "less",
        tolerance: 0,
      },
    });
    const traj = simulateSandbox(s);
    const last = traj.frames[traj.frames.length - 1]!;
    // Equal masses swap velocities: A rebounds left, B rebounds right.
    expect(last.bodies[0]!.vx).toBeLessThan(-1.5);
    expect(last.bodies[1]!.vx).toBeGreaterThan(1.5);
    // Momentum stays conserved (net zero) through the impulse.
    expect(last.bodies[0]!.vx + last.bodies[1]!.vx).toBeCloseTo(0, 4);
  });
});

describe("simulateSandbox floor", () => {
  it("never lets a body pass through the floor and loses energy on bounce", () => {
    const s = scene({
      gravity: 10,
      hasFloor: true,
      restitution: 0.5,
      duration: 4,
      bodies: [body("a", { radius: 0.5, position: { x: 0, y: 8 } })],
      outcomeRule: { kind: "compare_change", metric: "max_height", body: "a", tolerance: 0.01 },
    });
    const traj = simulateSandbox(s);
    for (const frame of traj.frames) {
      expect(frame.bodies[0]!.y).toBeGreaterThanOrEqual(0.5 - 1e-6);
    }
  });
});

describe("sandbox outcome classification", () => {
  it("compare_bodies: lower drop reaches the floor first", () => {
    const s = scene({
      gravity: 10,
      hasFloor: true,
      duration: 4,
      bodies: [
        body("a", { position: { x: -2, y: 5 } }),
        body("b", { position: { x: 2, y: 15 } }),
      ],
      outcomeRule: {
        kind: "compare_bodies",
        metric: "time_to_floor",
        bodyA: "a",
        bodyB: "b",
        comparator: "less",
        tolerance: 0.05,
      },
    });
    // Comparator "less" → "a" wins when A's time is smaller. A starts lower.
    expect(sandboxCompareBodies(s)).toBe("a");
  });

  it("compare_change: a larger drop height increases the fall time", () => {
    const before = scene({
      gravity: 10,
      hasFloor: true,
      duration: 5,
      bodies: [body("a", { position: { x: 0, y: 6 } })],
      outcomeRule: { kind: "compare_change", metric: "time_to_floor", body: "a", tolerance: 0.05 },
    });
    const after: SandboxScene = {
      ...before,
      bodies: [body("a", { position: { x: 0, y: 18 } })],
    };
    expect(sandboxCompareChange(before, after)).toBe("increase");
  });

  it("compare_bodies: equal metrics inside tolerance tie", () => {
    const s = scene({
      gravity: 10,
      hasFloor: true,
      duration: 4,
      bodies: [
        body("a", { mass: 1, position: { x: -2, y: 10 } }),
        body("b", { mass: 5, position: { x: 2, y: 10 } }),
      ],
      outcomeRule: {
        kind: "compare_bodies",
        metric: "time_to_floor",
        bodyA: "a",
        bodyB: "b",
        comparator: "less",
        tolerance: 0.05,
      },
    });
    // No drag → mass does not change fall time; the two tie.
    expect(sandboxCompareBodies(s)).toBe("tie");
  });
});

describe("buildSandboxEvidence", () => {
  it("returns a computed outcome, duration, and chart points", () => {
    const s = scene({
      gravity: 10,
      hasFloor: true,
      duration: 3,
      bodies: [
        body("a", { position: { x: -2, y: 6 } }),
        body("b", { position: { x: 2, y: 12 } }),
      ],
      outcomeRule: {
        kind: "compare_bodies",
        metric: "time_to_floor",
        bodyA: "a",
        bodyB: "b",
        comparator: "less",
        tolerance: 0.05,
      },
    });
    const evidence = buildSandboxEvidence({ scene: s });
    expect(evidence.outcomeKey).toBe("a");
    expect(evidence.duration).toBe(3);
    expect(evidence.points.length).toBeGreaterThan(5);
    expect(evidence.points[0]!.time).toBe(0);
    expect(evidence.metricA.value).toContain("s");
  });

  it("is deterministic: identical scenes yield identical trajectories", () => {
    const build = () =>
      simulateSandbox(
        scene({
          gravity: 9.81,
          duration: 2,
          bodies: [body("a", { position: { x: 1, y: 12 }, velocity: { x: 3, y: 1 } })],
          outcomeRule: { kind: "compare_change", metric: "final_x", body: "a", tolerance: 0.01 },
        }),
      );
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});
