import { describe, expect, it } from "vitest";
import { boundsForTrajectories, fitBounds } from "./view-transform";

const drop = [
  { t: 0, x: 0, y: 20 },
  { t: 1, x: 0, y: 15 },
  { t: 2, x: 0, y: 0 },
];

const pendulum = [
  { t: 0, x: 0.5, y: -1.9 },
  { t: 1, x: -0.5, y: -1.9 },
];

describe("boundsForTrajectories", () => {
  it("always keeps the ground (y = 0) and origin in frame", () => {
    const bounds = boundsForTrajectories("projectile", [
      [
        { t: 0, x: 0, y: 5 },
        { t: 1, x: 30, y: 12 },
        { t: 2, x: 40, y: 0 },
      ],
    ]);
    expect(bounds.minY).toBeLessThanOrEqual(0);
    expect(bounds.minX).toBeLessThanOrEqual(0);
    expect(bounds.maxX).toBeGreaterThanOrEqual(40);
    expect(bounds.maxY).toBeGreaterThanOrEqual(12);
  });

  it("gives a degenerate drop scene a usable horizontal extent", () => {
    const bounds = boundsForTrajectories("drop", [drop]);
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(0.5);
    expect(bounds.maxY).toBeGreaterThanOrEqual(20);
  });

  it("keeps the pendulum pivot in frame with headroom above it", () => {
    const bounds = boundsForTrajectories("pendulum", [pendulum]);
    expect(bounds.maxY).toBeGreaterThan(0);
    expect(bounds.minY).toBeLessThanOrEqual(-1.9);
  });

  it("unions bounds across base and patched trajectories", () => {
    const patched = [{ t: 0, x: 80, y: 3 }];
    const bounds = boundsForTrajectories("projectile", [drop, patched]);
    expect(bounds.maxX).toBeGreaterThanOrEqual(80);
    expect(bounds.maxY).toBeGreaterThanOrEqual(20);
  });
});

describe("fitBounds", () => {
  const bounds = { minX: 0, maxX: 10, minY: 0, maxY: 5 };

  it("maps the world rect inside the canvas margins", () => {
    const view = fitBounds(bounds, 800, 400, 20);
    for (const [x, y] of [
      [0, 0],
      [10, 5],
      [0, 5],
      [10, 0],
    ] as const) {
      const px = view.toPxX(x);
      const py = view.toPxY(y);
      expect(px).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(px).toBeLessThanOrEqual(800 - 20 + 1e-9);
      expect(py).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(py).toBeLessThanOrEqual(400 - 20 + 1e-9);
    }
  });

  it("uses one uniform scale for both axes (no stretching)", () => {
    const view = fitBounds(bounds, 800, 400, 20);
    const dx = view.toPxX(10) - view.toPxX(0);
    const dy = view.toPxY(0) - view.toPxY(5);
    expect(dx / 10).toBeCloseTo(view.scale, 9);
    expect(dy / 5).toBeCloseTo(view.scale, 9);
  });

  it("renders world up as canvas up (y flip)", () => {
    const view = fitBounds(bounds, 800, 400, 20);
    expect(view.toPxY(5)).toBeLessThan(view.toPxY(0));
  });

  it("centers the scene", () => {
    const view = fitBounds(bounds, 800, 400, 20);
    const left = view.toPxX(0);
    const right = 800 - view.toPxX(10);
    expect(left).toBeCloseTo(right, 6);
  });
});
