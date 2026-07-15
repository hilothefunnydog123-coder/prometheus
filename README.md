# Counterfactual Lab

Learn physics by predicting, breaking, and explaining tiny experiments. Type
(or photograph) what you're curious about; the AI compiler turns it into a
runnable 3D micro-experiment with a prediction question and one-variable
counterfactuals ("what if it were heavier? on the Moon?"); a rubric-based
evaluator grades your explanation; Bayesian Knowledge Tracing tracks what
you've actually mastered.

Student hackathon project. UI / 3D rendering is owned by the frontend
contributor (`codex/interactive-lab`); the AI compiler, validation,
evaluator, and mastery modules are owned by the backend contributor
(`claude/integration-backend`).

## Architecture

The single public contract is **`src/lib/contracts/experiment.ts`** —
copied from the renderer branch as the shared boundary, with exactly one
addition: an optional declarative `PredictionSpec.testChange`
(`{ targetPath, value }`) describing the controlled comparison a prediction
tests. Pendulum period questions compare two worlds and are otherwise not
evaluable without parsing prose.

```
learner prompt (+ gradeBand, optional image)
        │
        ▼
POST /api/compile  (multipart, strict MIME/size checks)
        │
        ▼
analyzeInput ──────────────► LearningIntent
  Featherless vision/text        │ heuristic keyword router on
  model, forced tool call        │ missing creds / any failure
        │                        │
        │        family "unknown"┴──► 422 unsupported_material
        ▼
compileExperiment
   │ 1. model emits spec via forced tool call (renderer contract v1.0)
   │ 2. validate: contract bounds, allowlisted targetPaths, two drop
   │    objects, outcome-vocabulary coverage, control/scene agreement,
   │    one-numeric-property counterfactuals, ≤ 20 s simulated time,
   │    no code / markup / shader / file-path strings
   │ 3. server computes and OVERWRITES correctOutcomeKey for the base
   │    prediction and every counterfactual (deterministic physics)
   │ 4. one repair attempt with concise errors
   │ 5. fallback: closest golden fixture, provenance
   │    "validated-example", disclosed via warnings (still HTTP 200)
   ▼
CompileResponse { spec, warnings, provenance } ──► 3D renderer

learner explanation
        │
        ▼
POST /api/evaluate (JSON) ──► { score, criteria, feedback, hint }
                                 │ score = passed rubric criteria / total,
                                 │ computed server-side; model only judges
                                 │ criteria and writes feedback text
                                 ▼
                  frontend applies results to mastery via BKT
                  (src/lib/mastery/bkt.ts, pure functions — the
                  evaluator never updates mastery)
```

### Deterministic correctness

`src/lib/ai/deterministic-outcomes.ts` is the ground truth for
`correctOutcomeKey`. The model proposes wording, safe numeric parameters,
objectives, and misconception content — never correctness. The tested
variable is always read from declarative data (`prediction.testChange` or
`counterfactual.change`), never inferred from question text.

- **drop** → `object_a_first | object_b_first | tie` from fall-time
  comparison (tie window 0.035 s). Vacuum: analytic `sqrt(2h/g)`. With
  drag: fixed-step semi-implicit Euler, quadratic drag `½·ρ·Cd·A·v²`,
  `dt = 1/240 s`, capped at 20 s.
- **projectile** → `undershoot | hit | overshoot` vs `targetDistance`
  (required) with tolerance `max(0.8 m, 5.5 %)`. Analytic without drag;
  same fixed-step integration with ρ = 1.2 kg/m³ when `dragCoefficient > 0`.
- **pendulum** → `period_increases | period_decreases | period_unchanged`
  by comparing small-angle periods `2π·sqrt(L/g)` before/after the declared
  change (±1 % counts as unchanged). Mass, damping, and release angle
  cancel — which is the point of the misconception probe.

### Module map (backend area)

| Path | Responsibility |
| --- | --- |
| `src/lib/contracts/experiment.ts` | **Public contract** (frozen boundary; shared with the renderer). |
| `src/lib/ai/deterministic-outcomes.ts` | Server-side outcome computation (above). |
| `src/lib/ai/scene-paths.ts` | Allowlisted `targetPath`s + per-path bounds + safe get/apply. |
| `src/lib/ai/validation.ts` | Domain validation + correctness finalization. |
| `src/lib/ai/text-rules.ts` | Plain-text rules: no code, markup, shader source, or file paths. |
| `src/lib/ai/featherless-client.ts` | Server-only OpenAI-compatible client (forced tool calls, timeout, typed errors, injectable fetch). |
| `src/lib/ai/prompts.ts` | System prompts, untrusted-input wrapping, tool JSON Schemas. |
| `src/lib/ai/analyze-input.ts` | prompt/image → LearningIntent; deterministic keyword fallback. |
| `src/lib/ai/compile-experiment.ts` | intent → CompileResponse; one repair; fixture fallback with disclosure. |
| `src/lib/ai/evaluate-explanation.ts` | explanation → EvaluationResponse; rubric-based; never touches mastery. |
| `src/lib/mastery/bkt.ts` | Bayesian Knowledge Tracing (pInit .25, pLearn .15, pGuess .20, pSlip .10), pure functions; persistence and update timing belong to the frontend. |
| `src/lib/fixtures/` | Golden fixtures (mirroring the renderer demos) + deterministic closest-match. |
| `src/lib/ai/eval/` | 30-case eval dataset + opt-in `npm run eval:compiler` (never in CI). |
| `src/app/api/compile/route.ts` | Multipart endpoint (`prompt`, `gradeBand`, optional image ≤ 4 MB). |
| `src/app/api/evaluate/route.ts` | JSON endpoint; feedback only. |
| `src/app/api/health/route.ts` | App/provider configuration without secrets. |

### Security & robustness invariants

- **Untrusted input**: learner text/images are data, never instructions —
  sanitized, delimited as `<user_input>`, forced through tool schemas, and
  fully re-validated server-side. Injection can at worst produce an invalid
  spec, which falls back to a golden fixture (or a 422 for off-topic text).
- **No executable content**: every spec string is rejected if it contains
  control characters, markup/angle brackets, code syntax, shader source, or
  file paths. Scene mutation goes only through allowlisted numeric paths.
- **Server-only secrets**: `FEATHERLESS_API_KEY` is read at call time inside
  browser-guarded modules; it never appears in errors, logs, `/api/health`,
  or the client bundle.
- **Deterministic degradation**: missing credentials, timeouts, provider
  errors, and failed repairs return HTTP 200 with the closest bundled
  fixture, `provenance.source = "validated-example"`, and the fallback
  disclosed through `warnings`.
- **Safe errors**: API error messages are static strings (never echo user
  input) and are HTML-escaped as defense in depth.
- **No live AI in tests/CI**: unit tests inject a fetch stub; route tests
  stub global fetch to fail loudly. The live eval script is opt-in and
  refuses to run when `CI` is set.

### Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `FEATHERLESS_API_KEY` | no¹ | — | Featherless API key (server-only). |
| `FEATHERLESS_TEXT_MODEL` | no | `Qwen/Qwen3-32B` | Routing/compiling/grading model. |
| `FEATHERLESS_VISION_MODEL` | no | `google/gemma-3-27b-it` | Used when the learner uploads an image. |
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
