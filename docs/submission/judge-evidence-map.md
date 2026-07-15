# Judge evidence map

Every submission claim must point to implemented evidence. The
[official rules](https://prometheus-july-ai-challenge.devpost.com/rules) were
verified on July 15, 2026: Educational Impact, Creative Use of AI/ML,
Technical Execution, and Pitch & Demo are worth 25 points each. The video cap is
two minutes and the submission deadline is July 30 at 11:59 PM, no extensions.

## Official criteria coverage

| Criterion | Strongest evidence |
| --- | --- |
| Educational Impact | Prediction-error learning loop, causal explanation, counterfactual transfer, and BKT mastery |
| Creative Use of AI/ML | Natural-language or image input compiled into question-aligned interactive worlds; AI feedback bounded by deterministic scoring |
| Technical Execution | Deterministic physics authority, strict request/model validation, explicit outage recovery, 229 unit/API tests, seven browser flows |
| Pitch & Demo | 1:52 script with simulation before 0:30, visible misconception change, real screenshots, and rehearsed backup path |

## AI/ML and learning

| Claim | Implemented evidence | Source | Caveat |
| --- | --- | --- | --- |
| Natural-language questions become runnable experiments | Two-stage intent and structured-spec compiler | `src/lib/ai/analyze-input.ts`, `src/lib/ai/compile-experiment.ts` | Live custom generation requires a configured provider |
| Diagram photos can drive intent analysis | Strict image validation plus vision-model input | `src/lib/ai/image-validation.ts`, `src/app/api/compile/route.ts` | Rehearse with the production vision model before showing judges |
| Generated experiments match the actual question | Post-schema question-alignment checks, including terminal velocity | `src/lib/ai/question-alignment.ts` | Six bounded mechanics families only |
| AI gives rubric feedback without controlling the score | Model returns bounded booleans; server computes passed/total | `src/lib/ai/evaluate-explanation.ts` | Explicit offline rubric is coarser and clearly labeled |
| Mastery reflects demonstrated understanding | Bayesian Knowledge Tracing with browser persistence | `src/lib/mastery/bkt.ts`, `src/lib/client/mastery-storage.ts` | Per-browser; no accounts |

## Product experience

| Claim | Implemented evidence | Demo moment | Caveat |
| --- | --- | --- | --- |
| Learners predict before seeing the answer | Run button stays locked until an outcome is selected | First prediction | Confidence is collected but BKT currently uses correctness only |
| Visual and numerical evidence agree | Shared evidence engine, impact metrics, continuous chart ticks | Evidence reveal | WebGL hardware acceleration recommended |
| One-variable counterfactual tests transfer | Declarative allowlisted `{targetPath, value}` update | Air-resistance second run | One counterfactual is shown in the two-minute demo |
| Failure is honest and demoable | Custom question remains unchanged; separate demo requires explicit click | Backup path | The demo is authored, not generated for the failed question |
| Screenshots are real | Final production build at 1440×900, no provider credentials | Submission gallery | Images are unedited captures |

## Technical execution

| Claim | Implemented evidence | Source |
| --- | --- | --- |
| The model never decides physics correctness | Server overwrites all outcome keys | `src/lib/physics/deterministic-outcomes.ts` |
| Physics claims are tested against analytic references | Drop, projectile, pendulum, spring, collision, orbit, limits, and determinism suites | `src/lib/physics/evidence.test.ts` |
| Prompt injection is contained by construction | Normalization, untrusted delimiters, forced tools, allowlists, revalidation | `src/lib/ai/prompts.ts`, `src/lib/ai/text-rules.ts` |
| API boundaries are strict | MIME, byte, dimension, schema, and grade-band validation | `src/app/api/**`, `tests/api/**` |
| Provider failures are safe | Timeout/cancellation, one transient HTTP retry, typed safe errors, and no provider bodies retained | `src/lib/ai/featherless-client.ts`, `src/lib/ai/errors.ts` |
| Repeated generation is bounded | Only successful generated responses enter the 50-entry, 10-minute TTL/LRU cache | `src/lib/ai/compile-cache.ts`, `src/app/api/compile/route.ts` |
| Automated verification is offline | 229 unit/API tests and seven Playwright flows | test suites and `playwright.config.ts` |

## Claims not to make

- Do not claim user studies, learning-outcome improvements, teacher quotes, or
  adoption numbers.
- Do not claim support for physics outside drop, projectile, pendulum, spring,
  collision, and orbit experiments.
- Do not claim the system is immune to prompt injection; say it is contained
  through layered validation.
- Do not claim an authored fallback was generated for a custom question.
- Do not present the offline rubric as AI feedback.
