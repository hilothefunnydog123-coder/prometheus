# Devpost submission copy

> Paste-ready copy for the Devpost form. Verified against
> `codex/integration-ui` @ `23542fd`. Anything marked **[branch-dependent]**
> must be re-checked (or cut) if the final merge does not include it.
>
> ⚠️ The official rules page
> (https://prometheus-july-ai-challenge.devpost.com/rules) could not be
> fetched from the build environment (Cloudflare 403 / blocked egress). The
> judging-criterion mapping below uses Devpost's standard four criteria —
> **verify the exact criteria on the live rules page before submitting** and
> adjust headings if they differ. See `judge-evidence-map.md`.

## Project title

Counterfactual Lab

## One-line tagline

Ask any physics question — the AI builds a 3D world, you predict what happens, and deterministic physics proves you right or wrong.

## Inspiration

We kept noticing the same thing while studying: an AI tutor can explain free
fall perfectly, and a week later half the class still bets the bowling ball
lands first. Reading the right answer doesn't dislodge a wrong intuition —
watching your own prediction fail does. Physics teachers have known this for
decades (it's why demo lectures exist); we wanted to give every student the
version of that experience a demo lecture can't: *you* pick the question,
*you* commit to a prediction, and *you* get to rerun the world with one
variable changed.

## What it does

You type a mechanics question — or photograph a textbook diagram — and pick
your grade band. The AI compiler turns it into a live 3D experiment with
sliders for the variables that matter. Before anything moves, you must lock
in a prediction ("the 8 kg sphere lands first / the 1 kg sphere / they land
together") and a confidence level. The simulation runs, and an evidence
notebook shows synchronized results — impact times to the hundredth of a
second next to a height-vs-time chart — beside the prediction you just made.
You explain the result in your own words and get rubric-based feedback with
a hint. Then the app changes exactly one variable (turn the air on, flatten
the launch angle, lengthen the string) and asks you to predict again in the
changed world. A Bayesian mastery meter updates from what you demonstrated:
in our demo run it drops from 25% to 18% after a wrong first prediction,
then climbs to 58% after a correct transfer test.

Three families ship today — free-fall drops, projectiles, and pendulums —
each built around a documented misconception. Off-topic questions get an
honest "not supported yet" instead of a fake simulation.

## How we built it

Next.js 15 App Router with React 19; the lab scene is React Three Fiber with
the Rapier physics engine, and the evidence charts are Recharts. The AI
pipeline is a two-stage server-side compiler against Featherless's
OpenAI-compatible API: an intent router (with a vision model for uploaded
diagrams) and a spec compiler whose output is forced through a JSON tool
schema into a single declarative `ExperimentSpec` contract shared with the
renderer. Every spec is validated against physics bounds, allowlisted scene
paths, and content-safety rules, given one repair round with the exact
validator errors, and otherwise replaced by a bundled, pre-validated example
— with the fallback disclosed to the user. A deterministic physics module,
shared by the renderer and the grader, computes every "correct" answer.
Mastery is Bayesian Knowledge Tracing implemented as pure functions and
persisted in the browser. 188 unit and API tests run with all provider calls
mocked, plus a Playwright end-to-end flow.

## How AI/ML is used

Three ways, each deliberately fenced:

1. **Compilation** — a text model (and a vision model for diagram photos)
   converts an untrusted natural-language question into a validated,
   declarative experiment spec: scene parameters, prediction choices,
   misconception rubric, counterfactuals.
2. **Explanation grading** — a model judges each rubric criterion
   true/false and writes the feedback and hint; the score itself is computed
   server-side as criteria passed / total.
3. **Mastery estimation** — classic Bayesian Knowledge Tracing (pInit 0.25,
   pLearn 0.15, pGuess 0.20, pSlip 0.10) updates from prediction outcomes.

The fence: the model **never decides physics correctness**. Every
`correctOutcomeKey` is recomputed by a deterministic engine from declarative
data — the tested change is a `{targetPath, value}` field, never parsed from
the question's prose. If the model writes a physically wrong answer key, the
server silently overwrites it.

## Challenges we ran into

- **Making the AI trustworthy enough to grade students.** Our answer was
  architectural, not prompt-based: force tool-schema output, validate
  everything, and move correctness out of the model entirely.
- **Pendulum questions broke our design.** "What happens if the bob gets
  heavier?" compares two worlds, and no scene snapshot contains that
  comparison. We had to extend the spec contract with one declarative field
  (`testChange`) rather than parse the question text — the only contract
  change the whole project needed.
- **Two contracts, three branches, unrelated git histories.** The renderer
  and compiler were built in parallel; we integrated through a frozen
  boundary contract commit instead of merging unrelated trees.
- **Prompt injection with a 3D renderer downstream.** Spec strings are
  rejected if they contain markup, code syntax, shader source, or file
  paths, so a hostile "question" can't reach WebGL or the DOM.

## Accomplishments we're proud of

- A complete predict → simulate → evidence → explain → counterfactual loop
  that runs in under two minutes, end to end, in the browser.
- The determinism guarantee: the simulation the learner watches and the
  grader that scores them share one physics implementation, so they can
  never disagree.
- Honest failure modes: no API key, provider timeout, or a model that emits
  garbage all degrade to bundled validated examples — disclosed in the UI,
  never silent, and the whole app remains demoable offline.
- 188 passing tests with zero live provider calls, covering malformed model
  output, repair, timeout, prompt injection, and API boundary abuse.

## What we learned

The most useful lesson was where *not* to use the model. Early on we let it
propose answer keys and treated validation as a formality; watching it
confidently mislabel a projectile outcome convinced us to invert the design
— AI authors the *experience* (wording, scenarios, feedback), deterministic
code owns the *truth*. We also learned that contracts beat coordination:
freezing one Zod schema as the boundary let three parallel workstreams
(renderer, physics, AI hardening) land without stepping on each other.

## What's next

- More families (springs, collisions, orbits) on the same contract — each is
  a scene schema, a deterministic outcome function, and a bundled example.
- Classroom mode: shareable experiment links and a teacher view of the
  misconceptions a class actually holds, powered by the same BKT data.
- Provider-retry and compile caching are already written on a side branch
  **[branch-dependent]** and are next to land after the hackathon merge.

## Built with

Next.js 15 · React 19 · TypeScript (strict) · React Three Fiber · Rapier ·
Recharts · Zod · Featherless AI (OpenAI-compatible chat completions, text +
vision models) · Vitest · Playwright

## Judging-criterion mapping (verify criteria wording on the rules page)

| Criterion (standard Devpost) | Our evidence |
| --- | --- |
| Quality of the Idea | Prediction-first learning loop built on a documented pedagogy insight (misconception confrontation + transfer test), not another chat wrapper; "0 answers handed to you" is the design principle. |
| Design & User Experience | Six-step progress rail (Ask → Predict → Test → Evidence → Change → Explain), evidence notebook pairing 3D replay with synchronized charts, locked controls during runs, grade-band toggle, honest fallback messaging. See the three screenshots in `docs/assets/submission/`. |
| Technological Implementation | AI-to-simulation compiler with schema-forced output, allowlisted validation, one-round repair, deterministic outcome engine shared between renderer and grader, BKT mastery, 188 mocked-provider tests + Playwright e2e. |
| Potential Impact | Works offline/free-tier by design (bundled validated examples), browser-only persistence, three misconception-centered families with a contract built for adding more. |

Full claim-by-claim evidence with file paths: `judge-evidence-map.md`.
