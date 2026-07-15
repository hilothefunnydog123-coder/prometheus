import { describe, expect, it } from "vitest";
import { dropDemo, projectileDemo } from "@/components/lab/demo-experiments";
import { questionAlignmentErrors } from "./question-alignment";

function terminalVelocitySpec() {
  const spec = structuredClone(dropDemo);
  if (spec.scene.family !== "drop") throw new Error("drop fixture");
  spec.id = "terminal-velocity-lab";
  spec.title = "Approaching Terminal Velocity";
  spec.objective =
    "Measure how air resistance makes falling speed approach terminal velocity.";
  spec.sourceSummary =
    "Two objects fall through air while speed and drag are measured over time.";
  spec.scene.airDensity = 1.225;
  spec.controls.push({
    id: "air-density",
    label: "Air density",
    unit: "kg/m³",
    min: 0,
    max: 2,
    step: 0.025,
    value: 1.225,
    targetPath: "scene.airDensity",
  });
  spec.measurements = [
    { id: "speed-a", label: "Object A velocity", unit: "m/s", color: "#ff8a3d" },
    { id: "speed-b", label: "Object B velocity", unit: "m/s", color: "#5de1ff" },
  ];
  spec.prediction.prompt =
    "Which object approaches the greater terminal velocity in air?";
  spec.misconception.title = "Terminal velocity is a fixed speed";
  spec.misconception.description =
    "Terminal velocity occurs when quadratic drag balances weight, so it depends on mass, area, drag coefficient, gravity, and air density.";
  return spec;
}

describe("questionAlignmentErrors", () => {
  it("rejects a vacuum Galileo fixture for a terminal-velocity question", () => {
    const errors = questionAlignmentErrors(
      dropDemo,
      "How does air resistance affect terminal velocity?",
    );
    expect(errors).toContain(
      "air-resistance questions require non-zero air density",
    );
    expect(errors.join(" ")).toContain("terminal velocity");
  });

  it("accepts a drag-enabled, velocity-measuring terminal-velocity lab", () => {
    expect(
      questionAlignmentErrors(
        terminalVelocitySpec(),
        "How does air resistance affect terminal velocity?",
      ),
    ).toEqual([]);
  });

  it("requires launch-angle questions to expose the launch angle", () => {
    const generic = structuredClone(projectileDemo);
    generic.controls = generic.controls.filter(
      (control) => control.targetPath !== "scene.launch.angleDegrees",
    );
    generic.counterfactuals[0]!.change.targetPath = "scene.launch.speed";
    generic.counterfactuals[0]!.prediction.testChange = {
      targetPath: "scene.launch.speed",
      value: 12,
    };
    expect(
      questionAlignmentErrors(
        generic,
        "How does launch angle affect projectile range?",
      ).join(" "),
    ).toContain("launch angle");
  });
});
