import { expect, test, type Page } from "@playwright/test";
import type { ExperimentSpec } from "@/lib/contracts/experiment";
import {
  dropDemo,
  pendulumDemo,
  projectileDemo,
} from "@/components/lab/demo-experiments";
import { sandboxDropSpec } from "@/lib/ai/testing/sandbox-fixture";

type FamilyFlow = {
  card: string;
  labTitle: string;
  initialChoice: string;
  counterfactualQuestion: string;
  counterfactualChoice: string;
  explanation: string;
  completionHeading: string;
  spec: ExperimentSpec;
};

const flows: FamilyFlow[] = [
  {
    card: "01 FREE FALL Do heavier objects fall faster? Enter experiment",
    labTitle: "The Galileo Drop",
    initialChoice: "A The 8 kg orange sphere",
    counterfactualQuestion:
      "With air resistance turned on, which sphere reaches the floor first now?",
    counterfactualChoice: "A The compact orange sphere",
    explanation:
      "The equal impact times show that mass does not change gravitational acceleration in a vacuum.",
    completionHeading: "The evidence changed your next prediction.",
    spec: dropDemo,
  },
  {
    card: "02 PROJECTILES Why does a thrown ball follow an arc? Enter experiment",
    labTitle: "The Hidden Second Motion",
    initialChoice: "C Past the target",
    counterfactualQuestion: "With the flatter launch, where will the ball land?",
    counterfactualChoice: "B Inside the target",
    explanation:
      "Horizontal velocity continued while gravity changed vertical velocity, producing the measured arc.",
    completionHeading: "You predicted it. Then transferred it.",
    spec: projectileDemo,
  },
  {
    card: "03 OSCILLATION Does a heavier pendulum swing faster? Enter experiment",
    labTitle: "The Massless Clock",
    initialChoice: "C The period stays the same",
    counterfactualQuestion: "With a longer string, what happens to the period?",
    counterfactualChoice: "A The period increases",
    explanation:
      "The measured period depends on string length and gravity, while the bob mass cancels from the timing.",
    completionHeading: "You predicted it. Then transferred it.",
    spec: pendulumDemo,
  },
];

async function finishLearningLoop(page: Page, flow: FamilyFlow) {
  let compileRequests = 0;
  await page.route("**/api/compile", async (route) => {
    compileRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        spec: flow.spec,
        warnings: ["AI generation is unavailable."],
        provenance: {
          source: "validated-example",
          generatedAt: new Date(0).toISOString(),
        },
      }),
    });
  });
  await page.route("**/api/evaluate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        score: 1,
        criteria: Object.fromEntries(
          flow.spec.misconception.explanationRubric.map((_, index) => [
            `criterion-${index + 1}`,
            true,
          ]),
        ),
        feedback:
          "Your explanation connected the measured evidence to the generated experiment's causal mechanism.",
        hint: "Change one measured variable and predict the result.",
      }),
    });
  });
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Don’t just learn the answer. Change the world.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Build my world" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: flow.card }).click();
  await expect(
    page.getByRole("heading", { name: flow.labTitle }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("listitem", { name: "Step 2 of 6: Predict, current" })).toBeVisible();
  expect(compileRequests).toBe(0);
  await expect(page.locator(".form-error")).toHaveCount(0);
  await expect(
    page.getByText("pre-coded, not AI-generated", { exact: false }),
  ).toBeVisible();
  if (flow.spec.scene.family === "projectile") {
    await expect(
      page.locator('[data-outcome-guides="hidden"]'),
    ).toHaveCount(1);
  }

  const run = page.getByRole("button", { name: "Lock prediction & run" });
  await expect(run).toBeDisabled();
  const firstConfidence = page.getByRole("slider", {
    name: "How confident are you?",
  });
  await firstConfidence.press("ArrowRight");
  await expect(page.getByText("63%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: flow.initialChoice }).click();
  await expect(run).toBeEnabled();
  await run.click();
  if (flow.spec.scene.family === "projectile") {
    await expect(
      page.locator('[data-outcome-guides="hidden"]'),
    ).toHaveCount(1);
  }

  await expect(
    page.getByRole("heading", { name: "What the world showed" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("You were 63% confident.", { exact: false })).toBeVisible();
  if (flow.spec.scene.family === "projectile") {
    await expect(
      page.locator('[data-outcome-guides="revealed"]'),
    ).toHaveCount(1);
  }
  await page
    .getByRole("textbox", {
      name: "What caused the result?",
    })
    .fill(flow.explanation);
  await page.getByRole("button", { name: "Check my explanation" }).click();

  const challenge = page.getByRole("button", {
    name: "Change one variable",
  });
  await expect(challenge).toBeVisible({ timeout: 10_000 });
  await challenge.click();

  await expect(
    page.getByRole("heading", { name: flow.counterfactualQuestion }),
  ).toBeVisible();
  const transferRun = page.getByRole("button", {
    name: "Lock prediction & run",
  });
  const secondConfidence = page.getByRole("slider", {
    name: "How confident are you?",
  });
  await secondConfidence.press("ArrowRight");
  await expect(page.getByText("51%", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: flow.counterfactualChoice })
    .click();
  await transferRun.click();

  await expect(
    page.getByRole("heading", {
      name: flow.completionHeading,
    }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Run 1 vs Run 2" })).toBeVisible();
  await expect(page.getByRole("listitem", { name: "Step 6 of 6: Transfer, complete" })).toBeVisible();
  await expect(page.getByText("63% confident", { exact: true })).toBeVisible();
  await expect(page.getByText("51% confident", { exact: true })).toBeVisible();
}

for (const flow of flows) {
  test(`${flow.labTitle} completes prediction, evidence, and counterfactual transfer`, async ({
    page,
  }) => {
    await finishLearningLoop(page, flow);
  });
}

test("generated sandbox experiment renders live and completes the full loop", async ({
  page,
}) => {
  // A generic AI-authored mechanics world (not one of the three specialised
  // families) must render, run its deterministic trajectory to completion, and
  // support the counterfactual transfer — proving the sandbox path is live.
  await page.route("**/api/compile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        spec: sandboxDropSpec(),
        warnings: [],
        provenance: {
          source: "generated",
          model: "test-model",
          generatedAt: new Date(0).toISOString(),
        },
      }),
    });
  });
  await page.route("**/api/evaluate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        score: 1,
        criteria: { c1: true, c2: true },
        feedback: "You tied the measured fall timing to equal acceleration.",
        hint: "Now change the air density and predict again.",
      }),
    });
  });

  await page.goto("/");
  await page
    .getByRole("textbox", { name: "What do you want to understand?" })
    .fill("Do heavier balls fall faster than lighter balls?");
  await page.getByRole("button", { name: "Build my world" }).click();

  await expect(
    page.getByRole("heading", {
      name: "Released together in a vacuum, which heavier ball reaches the floor first?",
    }),
  ).toBeVisible({ timeout: 15_000 });

  await page
    .getByRole("button", { name: "A The heavier ball lands first" })
    .click();
  await page.getByRole("button", { name: "Lock prediction & run" }).click();

  // Reaching the evidence heading proves the sandbox trajectory played to its
  // end and fired onComplete with computed evidence.
  await expect(
    page.getByRole("heading", { name: "What the world showed" }),
  ).toBeVisible({ timeout: 20_000 });

  await page
    .getByRole("textbox", { name: "What caused the result?" })
    .fill(
      "In a vacuum both balls share the same acceleration, so the heavier mass does not reach the floor sooner.",
    );
  await page.getByRole("button", { name: "Check my explanation" }).click();

  const challenge = page.getByRole("button", { name: "Change one variable" });
  await expect(challenge).toBeVisible({ timeout: 10_000 });
  await challenge.click();

  await expect(
    page.getByRole("heading", {
      name: "With thick air, which heavier ball reaches the floor first?",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "A The heavier ball lands first" })
    .click();
  await page.getByRole("button", { name: "Lock prediction & run" }).click();

  await expect(
    page.getByRole("heading", {
      name: "The evidence changed your next prediction.",
    }),
  ).toBeVisible({ timeout: 20_000 });
});

test("provider outage never relabels a question and requires explicit backup choices", async ({
  page,
}) => {
  await page.route("**/api/compile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        spec: dropDemo,
        warnings: [
          "The AI compiler is not configured on this server. You are running a validated example experiment instead.",
        ],
        provenance: {
          source: "validated-example",
          generatedAt: new Date(0).toISOString(),
        },
      }),
    });
  });
  await page.route("**/api/evaluate", async (route) => {
    const offline =
      route.request().headers()["x-counterfactual-feedback-mode"] ===
      "heuristic";
    if (!offline) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "ai_not_configured",
            message: "AI explanation feedback is not configured on this deployment.",
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-counterfactual-feedback-source": "heuristic" },
      body: JSON.stringify({
        score: 0.33,
        criteria: { evidence: true, causality: false, transfer: false },
        feedback:
          "Automated grading is offline, so this rough score checks the rubric's key ideas.",
        hint: "Compare your reasoning with the measured evidence.",
      }),
    });
  });

  await page.goto("/");
  await page
    .getByRole("textbox", { name: "What do you want to understand?" })
    .fill("How does air resistance affect terminal velocity?");
  await page.getByRole("button", { name: "Build my world" }).click();

  await expect(
    page.getByText("AI generation was unavailable", { exact: false }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole("button", { name: "Open the validated drop demo" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open the validated drop demo" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Do heavier objects fall faster?" }),
  ).toBeVisible();
  await expect(
    page.getByText("not generated for the prior question", { exact: false }),
  ).toBeVisible();

  // The provenance disclosure must never be clipped mid-sentence: visibility
  // alone does not catch CSS ellipsis/overflow truncation, so measure it.
  const noticeClipping = await page
    .locator(".compiler-notice")
    .evaluate((el) => ({
      horizontal: el.scrollWidth - el.clientWidth,
      vertical: el.scrollHeight - el.clientHeight,
    }));
  expect(noticeClipping.horizontal).toBeLessThanOrEqual(1);
  expect(noticeClipping.vertical).toBeLessThanOrEqual(1);

  await page
    .getByRole("button", { name: "A The 8 kg orange sphere" })
    .click();
  await page.getByRole("button", { name: "Lock prediction & run" }).click();
  await expect(
    page.getByRole("heading", { name: "What the world showed" }),
  ).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole("textbox", { name: "What caused the result?" })
    .fill(
      "The measured times match because both spheres have the same gravitational acceleration in vacuum.",
    );
  await page.getByRole("button", { name: "Check my explanation" }).click();
  await expect(
    page.getByRole("button", { name: "Continue with an offline rubric" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Continue with an offline rubric" })
    .click();
  await expect(page.getByText("Offline rubric check", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Change one variable" }).click();
  await page
    .getByRole("button", { name: "A The compact orange sphere" })
    .click();
  await page.getByRole("button", { name: "Lock prediction & run" }).click();
  await expect(
    page.getByRole("heading", {
      name: "The evidence changed your next prediction.",
    }),
  ).toBeVisible({ timeout: 15_000 });
});

test("landing comfort controls, grade selection, prompt limit, and diagram removal work", async ({
  page,
}) => {
  await page.goto("/");

  const seniorGrade = page.getByRole("button", { name: "11–12" });
  await seniorGrade.click();
  await expect(seniorGrade).toHaveAttribute("aria-pressed", "true");

  const starter = page.getByRole("button", {
    name: "What makes a pendulum's period longer?",
  });
  await starter.click();
  const question = page.getByRole("textbox", {
    name: "What do you want to understand?",
  });
  await expect(question).toHaveValue("What makes a pendulum's period longer?");

  await question.fill("x".repeat(550));
  await expect(question).toHaveValue("x".repeat(500));
  await expect(
    page.getByRole("status", { name: "500 of 500 characters used" }),
  ).toHaveText("500/500");

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "diagram.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByAltText("Uploaded textbook diagram preview")).toBeVisible();
  await page.getByRole("button", { name: "Remove image" }).click();
  await expect(page.getByAltText("Uploaded textbook diagram preview")).toHaveCount(0);
});

test("camera navigation, expanded view, variable controls, and safe exit all work", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "02 PROJECTILES Why does a thrown ball follow an arc? Enter experiment",
    })
    .click();

  const canvas = page.locator("[data-camera-command]");
  await expect(canvas).toHaveAttribute("data-camera-command", "reset-0");
  await page.getByRole("button", { name: "Zoom simulation in" }).click();
  await expect(canvas).toHaveAttribute("data-camera-command", "zoom-in-1");
  await page.getByRole("button", { name: "Zoom simulation out" }).click();
  await expect(canvas).toHaveAttribute("data-camera-command", "zoom-out-2");
  await page.getByRole("button", { name: "Recenter simulation view" }).click();
  await expect(canvas).toHaveAttribute("data-camera-command", "reset-3");
  await page.keyboard.press("0");
  await expect(canvas).toHaveAttribute("data-camera-command", "reset-4");

  const launchSpeed = page.getByRole("slider", { name: "Launch speed" });
  await expect(launchSpeed).toHaveValue("15");
  await page.getByRole("button", { name: "Increase Launch speed" }).click();
  await expect(launchSpeed).toHaveValue("16");

  await page.getByRole("button", { name: "Expand simulation view" }).click();
  await expect(
    page.getByRole("dialog", { name: "Expanded simulation view" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Expand simulation view" }),
  ).toBeVisible();

  const choice = page.getByRole("button", { name: "C Past the target" });
  await choice.click();
  await page.getByRole("button", { name: "Clear run" }).click();
  await expect(choice).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("button", { name: "Lock prediction & run" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "New experiment" }).click();
  const leaveDialog = page.getByRole("dialog", { name: "Leave this experiment?" });
  await expect(leaveDialog).toBeVisible();
  await page.getByRole("button", { name: "Keep experimenting" }).click();
  await expect(page.getByRole("heading", { name: "The Hidden Second Motion" })).toBeVisible();
  await page.getByRole("button", { name: "New experiment" }).click();
  await page.getByRole("button", { name: "Leave experiment" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Don’t just learn the answer. Change the world.",
    }),
  ).toBeVisible();
});

test("playback pause, resume, replay, and reset controls change the run state", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "02 PROJECTILES Why does a thrown ball follow an arc? Enter experiment",
    })
    .click();
  await page.getByRole("button", { name: "C Past the target" }).click();
  await page.getByRole("button", { name: "Lock prediction & run" }).click();

  const pause = page.getByRole("button", { name: "Pause simulation" });
  await expect(pause).toBeVisible();
  await pause.click();
  const resume = page.getByRole("button", { name: "Resume simulation" });
  await expect(resume).toBeVisible();
  await resume.click();

  await expect(
    page.getByRole("heading", { name: "What the world showed" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Replay experiment" }).click();
  await expect(page.getByRole("button", { name: "Pause simulation" })).toBeVisible();
  await page.getByRole("button", { name: "Reset experiment" }).click();
  await expect(
    page.getByRole("button", { name: "Lock prediction & run" }),
  ).toBeEnabled();
  await expect(page.locator('[data-outcome-guides="hidden"]')).toHaveCount(1);
});

test("a prediction-controlled variable is visibly reserved for a valid one-variable test", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "03 OSCILLATION Does a heavier pendulum swing faster? Enter experiment",
    })
    .click();
  await expect(page.getByText("tested in this run", { exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Bob mass" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Increase Bob mass" })).toBeDisabled();
});

test("landing and lab avoid horizontal overflow on a phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);

  await page
    .getByRole("button", {
      name: "01 FREE FALL Do heavier objects fall faster? Enter experiment",
    })
    .click();
  await expect(page.getByRole("heading", { name: "The Galileo Drop" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
