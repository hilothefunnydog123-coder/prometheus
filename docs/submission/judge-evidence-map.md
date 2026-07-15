# Judge evidence map

Purpose: every claim we make to judges, traced to real code, with its
caveats. If a claim is not on this list, do not make it.

> ⚠️ **Criteria caveat**: the official rules page
> (https://prometheus-july-ai-challenge.devpost.com/rules) was unreachable
> from the build environment (Cloudflare 403 / blocked egress), so the
> criteria below are Devpost's standard template (Quality of the Idea,
> Design & User Experience, Technological Implementation, Potential Impact)
> plus the challenge brief's theme ("an educational tool that leverages
> AI/ML to make knowledge more accessible, engaging, or personalized").
> **Verify the live rules page and re-map before submitting.**
>
> All "Integrated?" answers refer to `codex/integration-ui` @ `23542fd`,
> the branch this package was built and screenshotted from.

## Theme fit — AI/ML for learning

| Claim | Feature | Source | In demo | Caveat | Integrated? |
| --- | --- | --- | --- | --- | --- |
| AI compiles natural-language questions into runnable experiments | Two-stage compiler (intent → spec) with forced tool calls | `src/lib/ai/analyze-input.ts`, `src/lib/ai/compile-experiment.ts`, `src/lib/ai/prompts.ts` | 0:08 "Build my world" | Live path needs `FEATHERLESS_API_KEY`; offline serves bundled examples (disclosed) | ✅ Integrated |
| Textbook diagram photos are understood via a vision model | Image upload → vision-model intent routing | `src/lib/ai/analyze-input.ts` (vision model selection), `src/lib/ai/image-validation.ts` | Not in the 1:52 cut (mention only if asked) | Never demoed offline; do not show unrehearsed | ✅ Integrated |
| AI grades explanations against a rubric | Criterion-by-criterion model grading; score computed server-side | `src/lib/ai/evaluate-explanation.ts`, `src/app/api/evaluate/route.ts` | 0:55 "Check my explanation" | Offline = deterministic keyword heuristic (still rubric-shaped) | ✅ Integrated |
| Mastery is estimated with Bayesian Knowledge Tracing | BKT (pInit .25, pLearn .15, pGuess .20, pSlip .10), browser persistence | `src/lib/mastery/bkt.ts`, `src/lib/client/mastery-storage.ts` | 1:38 mastery card (25→18→58) | Per-browser localStorage; no accounts | ✅ Integrated |

## Quality of the idea

| Claim | Feature | Source | In demo | Caveat | Integrated? |
| --- | --- | --- | --- | --- | --- |
| Prediction-first learning: commit before you see | Locked prediction + confidence slider gate the run | `src/components/CounterfactualLab.tsx` (PredictionPanel, "Lock prediction & run") | 0:18 | — | ✅ Integrated |
| Misconception-centered design | Each spec carries a named misconception + explanation rubric | `src/lib/contracts/experiment.ts` (misconceptionSchema), demo specs in `src/components/lab/demo-experiments.ts` | 0:55 feedback panel | Three misconceptions ship today | ✅ Integrated |
| Counterfactuals = transfer tests, not repetition | One-variable declarative change re-runs the world | `experiment.ts` (counterfactualSchema.change), UI "Change one variable" | 1:10 air-resistance flip | Exactly 1 counterfactual shown per session flow | ✅ Integrated |

## Design & user experience

| Claim | Feature | Source | In demo | Caveat | Integrated? |
| --- | --- | --- | --- | --- | --- |
| Guided six-step flow | Progress rail: Ask → Predict → Test → Evidence → Change → Explain | `src/components/CounterfactualLab.tsx` | Visible whole video | — | ✅ Integrated |
| Synchronized visual + numerical evidence | Evidence notebook: impact metrics + charts + prediction recap | `src/components/lab/EvidenceChart.tsx`, evidence panel | 0:40 | Chart tooltip shows unformatted floats (see merge-readiness #5) — avoid hovering the tooltip on camera | ✅ Integrated |
| Works beautifully offline | Bundled example cards; fallbacks disclosed in-UI | `src/lib/ai/validated-examples.ts`, `src/components/lab/demo-experiments.ts` | Entire backup script | — | ✅ Integrated |
| Screenshots are real and unedited | Production build, offline, 1440×900 | `docs/assets/submission/*.png` | n/a | Captured at `23542fd`; retake after final merge if UI changes | ✅ (this branch) |

## Technological implementation

| Claim | Feature | Source | In demo | Caveat | Integrated? |
| --- | --- | --- | --- | --- | --- |
| The model never decides correctness | Server recomputes and overwrites every `correctOutcomeKey` from declarative data (`testChange` / `counterfactual.change`) | `src/lib/ai/validation.ts`, `src/lib/ai/deterministic-outcomes.ts` → re-exports `src/lib/physics/deterministic-outcomes.ts` | Implicit (0:28, 1:25 outcomes) | — | ✅ Integrated |
| Renderer and grader share one physics implementation | Single deterministic engine; documented tolerances (drop tie 1/30 s; projectile target radius 0.92 m; pendulum period ±1%; 3600 s solver safeguard) | `src/lib/physics/evidence.ts` (exported constants), `src/lib/physics/AI_INTEGRATION.md` | 0:28 vs 1:25 consistency | Tolerances differ from the older `claude/integration-backend` engine — that branch's constants are superseded | ✅ Integrated |
| Schema-forced AI output + validation + one repair round + disclosed fallback | Compile pipeline with repair and `provenance.source = "validated-example"` fallbacks | `src/lib/ai/compile-experiment.ts`, `src/lib/ai/validation.ts` | Fallback path IS the backup demo | — | ✅ Integrated |
| Prompt-injection containment | Untrusted-input wrapping + content rules (no markup/code/shader/paths) + full revalidation | `src/lib/ai/prompts.ts` (wrapUntrusted), `src/lib/ai/text-rules.ts` | Not shown; cite if asked | Defense-in-depth claim, not "immune" | ✅ Integrated |
| Strict API boundary | Multipart/MIME/size limits, 422 for unsupported topics, safe error strings, body-size guards | `src/app/api/compile/route.ts`, `src/app/api/_shared/request-body.ts`, `src/app/api/evaluate/route.ts` | Not shown | — | ✅ Integrated |
| Health endpoint without secrets | `GET /api/health` → `{ status, aiProviderConfigured }` | `src/app/api/health/route.ts` | Not shown; used on demo day | Response is minimal by design — do not claim it reports models | ✅ Integrated |
| 188 tests, zero live provider calls | Vitest unit + API suites with injected/stubbed fetch | `src/lib/**/**.test.ts`, `tests/api/*.test.ts` (`npm test` at `23542fd`) | Not shown; citable | Count is branch-specific; re-run after final merge | ✅ Integrated |
| End-to-end browser test | Playwright lab flow | `tests/e2e/lab-flow.spec.ts`, `playwright.config.ts` | Not shown | Separate from `npm test` | ✅ Integrated |
| 30-case compiler evaluation harness | Opt-in routing/fallback/latency eval, CI-guarded | `src/lib/ai/eval/dataset.ts`, `src/lib/ai/eval/run-eval.ts` | Not shown | Offline mode measures the heuristic path only; NEVER quote its 100% routing accuracy as a model benchmark | ✅ Integrated |
| Transient-provider retry (single, 250 ms) | Client retries 429/5xx once | `claude/integration-backend` @ `2fb7556` (`src/lib/ai/featherless-client.ts`) | Do NOT claim in demo | **Branch-dependent — NOT in the integrated app** | ❌ Unmerged |
| Compile response TTL/LRU cache | Per-instance cache of generated responses | `claude/integration-backend` @ `6ed50ea` (`src/lib/ai/compile-cache.ts`) | Do NOT claim in demo | **Branch-dependent — NOT in the integrated app** | ❌ Unmerged |

## Potential impact

| Claim | Feature | Source | In demo | Caveat | Integrated? |
| --- | --- | --- | --- | --- | --- |
| Runs with zero AI cost for schools | Full loop works offline: bundled examples + heuristic rubric | `validated-examples.ts`, `evaluate-explanation.ts` heuristic | Backup script end-to-end | Live compile of arbitrary questions does require a provider key | ✅ Integrated |
| Extensible by contract | New family = scene schema + outcome fn + example | `src/lib/contracts/experiment.ts` discriminated union | "What's next" copy only | Springs/collisions/orbits are FUTURE — never present-tense | n/a (roadmap) |
| Grade-band personalization | 8–10 / 11–12 toggle feeds the compiler | Landing grade switch; `gradeBandSchema` in contract + compile route | 0:08 (visible toggle) | Depth of adaptation depends on the live model; bundled examples are authored for 8–10 | ✅ Integrated |

## Claims we must NOT make (checked and rejected)

- Any user counts, pilot studies, teacher quotes, or learning-outcome
  statistics — none exist.
- "Model accuracy" or "schema pass rate" numbers — the eval harness has only
  been run offline in this environment (fallback path by construction).
- "Supports any physics topic" — three families; everything else 422s.
- "Retries provider failures" / "caches compiles" — unmerged
  (`claude/integration-backend` only).
- Specific default model names as a product fact — defaults differ between
  branches (see merge-readiness #3); say "Featherless-hosted open models,
  configurable via environment variables" instead.
- "Immune to prompt injection" — say "contained by construction" with the
  fallback story.
