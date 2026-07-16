import { expect, test, type Page } from "@playwright/test";
import type { ExperimentSpec } from "@/lib/contracts/experiment";
import {
  dropDemo,
  pendulumDemo,
  projectileDemo,
} from "@/components/lab/demo-experiments";

type FamilyFlow = {
  card: string;
  labTitle: string;
  initialChoice: string;
  counterfactualQuestion: string;
  counterfactualChoice: string;
  explanation: string;
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
  expect(compileRequests).toBe(0);
  await expect(page.locator(".form-error")).toHaveCount(0);
  await expect(
    page.getByText("pre-coded, not AI-generated", { exact: false }),
  ).toBeVisible();

  const run = page.getByRole("button", { name: "Lock prediction & run" });
  await expect(run).toBeDisabled();
  await page.getByRole("button", { name: flow.initialChoice }).click();
  await expect(run).toBeEnabled();
  await run.click();

  await expect(
    page.getByRole("heading", { name: "What the world showed" }),
  ).toBeVisible({ timeout: 15_000 });
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
  await page
    .getByRole("button", { name: flow.counterfactualChoice })
    .click();
  await transferRun.click();

  await expect(
    page.getByRole("heading", {
      name: "You didn’t memorize it. You tested it.",
    }),
  ).toBeVisible({ timeout: 15_000 });
}

for (const flow of flows) {
  test(`${flow.labTitle} completes prediction, evidence, and counterfactual transfer`, async ({
    page,
  }) => {
    await finishLearningLoop(page, flow);
  });
}

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
      name: "You didn’t memorize it. You tested it.",
    }),
  ).toBeVisible({ timeout: 15_000 });
});
