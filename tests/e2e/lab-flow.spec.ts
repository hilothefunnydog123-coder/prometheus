import { expect, test, type Page } from "@playwright/test";

type FamilyFlow = {
  card: string;
  labTitle: string;
  initialChoice: string;
  counterfactualQuestion: string;
  counterfactualChoice: string;
  explanation: string;
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
  },
  {
    card: "02 PROJECTILES Why does a thrown ball follow an arc? Enter experiment",
    labTitle: "The Hidden Second Motion",
    initialChoice: "C Past the target",
    counterfactualQuestion: "With the flatter launch, where will the ball land?",
    counterfactualChoice: "B Inside the target",
    explanation:
      "Horizontal velocity continued while gravity changed vertical velocity, producing the measured arc.",
  },
  {
    card: "03 OSCILLATION Does a heavier pendulum swing faster? Enter experiment",
    labTitle: "The Massless Clock",
    initialChoice: "C The period stays the same",
    counterfactualQuestion: "With a longer string, what happens to the period?",
    counterfactualChoice: "A The period increases",
    explanation:
      "The measured period depends on string length and gravity, while the bob mass cancels from the timing.",
  },
];

async function finishLearningLoop(page: Page, flow: FamilyFlow) {
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

  const run = page.getByRole("button", { name: "Run experiment" });
  await expect(run).toBeDisabled();
  await page.getByRole("button", { name: flow.initialChoice }).click();
  await expect(run).toBeEnabled();
  await run.click();

  await expect(
    page.getByRole("heading", { name: "What the world showed" }),
  ).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole("textbox", {
      name: "Now explain the result in your own words.",
    })
    .fill(flow.explanation);
  await page.getByRole("button", { name: "Test my explanation" }).click();

  const challenge = page.getByRole("button", {
    name: "Challenge this model",
  });
  await expect(challenge).toBeVisible({ timeout: 10_000 });
  await challenge.click();

  await expect(
    page.getByRole("heading", { name: flow.counterfactualQuestion }),
  ).toBeVisible();
  const transferRun = page.getByRole("button", { name: "Run experiment" });
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
