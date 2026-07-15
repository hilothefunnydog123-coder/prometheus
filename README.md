# Counterfactual Lab

Learn physics by predicting, breaking, and explaining tiny experiments. Type
(or photograph) what you're curious about; the AI compiler turns it into a
runnable micro-experiment with a prediction question and one-variable
counterfactuals ("what if it were heavier? on the Moon?"); a rubric-based
evaluator grades your explanation; Bayesian Knowledge Tracing tracks what
you've actually mastered.

Student hackathon project. UI / 3D rendering is owned by Contributor A; the
AI compiler, validation, evaluator, and mastery modules are owned by
Contributor B.

## Architecture

```
learner text (+ optional image)
        │
        ▼
POST /api/compile  (multipart, strict MIME/size checks)
        │
        ▼
analyzeInput ──────────────► LearningIntent (Zod-validated)
  Featherless vision/text        │ heuristic keyword router on
  model, forced tool call        │ missing creds / any failure
        │                        ▼
        └──────────────► compileExperiment
                              │ 1. model emits spec via forced tool call
                              │ 2. validate: Zod schema + bounds + family
                              │    feasibility + prediction coverage +
                              │    counterfactual patch allowlist
                              │ 3. one repair attempt w/ concise errors
                              │ 4. deterministic fallback: closest golden
                              │    fixture (drop / projectile / pendulum)
                              ▼
                        ExperimentSpec  ──► 3D renderer (Contributor A)

learner explanation
        │
        ▼
POST /api/evaluate (JSON) ──► evaluateExplanation ──► rubric + feedback
                                   │                   (never touches mastery)
                                   ▼
                     client applies masterySignal via BKT module
                     (src/lib/mastery/bkt.ts, pure functions)
```

### Module map (Contributor B's area)

| Path | Responsibility |
| --- | --- |
| `src/lib/ai/contracts/experiment-spec.ts` | **Public ExperimentSpec contract** (Zod). Families, parameter bounds, counterfactual allowlists. Breaking changes require a documented incompatibility note. |
| `src/lib/ai/contracts/learning-intent.ts` | LearningIntent contract (router output). |
| `src/lib/ai/contracts/evaluation.ts` | Rubric contract + deterministic overall/masterySignal derivation. |
| `src/lib/ai/featherless-client.ts` | Server-only OpenAI-compatible client (forced tool calls, timeout, typed errors, injectable fetch). |
| `src/lib/ai/prompts.ts` | System prompts, untrusted-input wrapping, hand-written tool JSON Schemas (Zod stays authoritative). |
| `src/lib/ai/analyze-input.ts` | text/image → LearningIntent; deterministic keyword heuristic fallback. |
| `src/lib/ai/compile-experiment.ts` | intent → validated ExperimentSpec; one repair round; fixture fallback. |
| `src/lib/ai/validation.ts` | Bounds, family feasibility (event fits simulation window), prediction outcome coverage, single-property counterfactual patch checks. |
| `src/lib/ai/evaluate-explanation.ts` | Explanation → rubric. Total function; heuristic fallback. Never updates mastery. |
| `src/lib/mastery/bkt.ts` | Bayesian Knowledge Tracing (pInit .25, pLearn .15, pGuess .20, pSlip .10), pure functions. |
| `src/lib/fixtures/` | Golden fixtures (drop, projectile, pendulum) + deterministic closest-fixture selection. |
| `src/lib/ai/eval/` | 30-case eval dataset + opt-in `npm run eval:compiler` script (never in CI). |
| `src/app/api/compile/route.ts` | Multipart endpoint: text ≤ 2000 chars; optional PNG/JPEG/WebP image ≤ 4 MB. |
| `src/app/api/evaluate/route.ts` | JSON endpoint: rubric feedback only, mastery updates are explicitly out of scope. |

### Security & robustness invariants

- **Untrusted input**: learner text/images are data, never instructions.
  Inputs are sanitized (control chars stripped, length-capped), delimited as
  `<user_input>`, and — decisively — every model response passes through a
  forced tool call and full server-side validation. A successful injection
  can at worst produce an invalid spec, which falls back to a golden fixture.
- **No code execution**: specs are declarative data; every text field rejects
  control characters and angle brackets at the schema level.
- **Server-only secrets**: `FEATHERLESS_API_KEY` is read at call time inside
  server modules guarded by a browser-environment assertion; it never appears
  in errors, logs, or the client bundle.
- **Deterministic degradation**: missing credentials, timeouts, provider
  errors, and failed repairs all resolve to the closest bundled fixture — the
  API never returns an invalid spec and never 500s for provider trouble.
- **Safe errors**: API error messages are static strings (never echo user
  input) and are HTML-escaped as defense in depth.
- **No live AI in tests/CI**: unit tests inject a fetch stub; route tests
  stub global fetch with a fail-loudly implementation. The live eval script
  is opt-in and refuses to run when `CI` is set.

### Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `FEATHERLESS_API_KEY` | no¹ | — | Featherless API key (server-only). |
| `FEATHERLESS_TEXT_MODEL` | no | `meta-llama/Meta-Llama-3.1-8B-Instruct` | Text routing/compiling/grading model. |
| `FEATHERLESS_VISION_MODEL` | no | `Qwen/Qwen2.5-VL-7B-Instruct` | Used when the learner uploads an image. |
| `FEATHERLESS_BASE_URL` | no | `https://api.featherless.ai/v1` | OpenAI-compatible endpoint. |
| `FEATHERLESS_TIMEOUT_MS` | no | `20000` | Per-request provider timeout. |

¹ Without a key the whole pipeline still works deterministically (fixtures +
heuristic rubric) — useful for demos and CI.

### Scripts

```bash
npm run dev            # Next.js dev server
npm run test           # vitest unit tests (all provider calls mocked)
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm run build          # production build
npm run eval:compiler  # OPT-IN 30-case eval (live if key set; never in CI)
```
