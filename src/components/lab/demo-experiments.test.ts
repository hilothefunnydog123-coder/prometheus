import { describe, expect, it } from "vitest";
import { experimentSpecSchema } from "@/lib/contracts/experiment";
import {
  collisionDemo,
  demoExperiments,
  demoForPrompt,
  dropDemo,
  orbitDemo,
  pendulumDemo,
  projectileDemo,
  springDemo,
} from "./demo-experiments";

describe("bundled interactive experiments", () => {
  it.each(demoExperiments.map((spec) => [spec.id, spec]))(
    "%s satisfies the renderer contract",
    (_id, spec) => {
      expect(experimentSpecSchema.safeParse(spec).success).toBe(true);
    },
  );

  it("routes supported prompts deterministically", () => {
    expect(demoForPrompt("Does a longer pendulum swing slowly?")).toBe(
      pendulumDemo,
    );
    expect(demoForPrompt("Launch a projectile toward a target")).toBe(
      projectileDemo,
    );
    expect(demoForPrompt("How does a spring period change with stiffness?")).toBe(
      springDemo,
    );
    expect(demoForPrompt("Conserve momentum in an elastic collision")).toBe(
      collisionDemo,
    );
    expect(demoForPrompt("Find the escape velocity of a satellite")).toBe(
      orbitDemo,
    );
    expect(demoForPrompt("Drop two objects from a tower")).toBe(dropDemo);
  });
});
