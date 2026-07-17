# Counterfactual Lab — App Readiness Audit

Audit date: July 16, 2026  
Production URL: https://promhack.netlify.app  
Canonical branch: `main`

## Outcome

The core learning journey is submission-ready after the changes in this audit. The app now protects in-progress work, exposes reliable camera navigation, keeps prediction confidence through the evidence cycle, presents a valid one-variable comparison, and ends with a concrete Run 1 vs Run 2 learning summary.

The AI compile/evaluation implementation was intentionally not changed. This pass only changes client behavior, 3D navigation, accessibility, regression coverage, and dependency safety.

## User journey health

| Step | User action | Health | Evidence |
| --- | --- | --- | --- |
| 1 | Open the landing page and choose grade level | Healthy | Grade controls expose pressed state; hero and form fit desktop and phone widths. |
| 2 | Enter a question, use a starter, or add/remove a diagram | Healthy | 500-character guard, visible count, starter prompts, image validation, preview, replacement, and removal are wired. |
| 3 | Open a validated experiment | Healthy | Presets open without invoking compile and retain explicit provenance. |
| 4 | Inspect the world and commit a prediction | Healthy | Outcome guides remain hidden; current run settings and saved confidence make the commitment unambiguous. |
| 5 | Navigate the 3D world | Healthy | Orbit, cursor-centered wheel zoom, right-drag pan, zoom buttons, recenter, `0` shortcut, expanded view, `F` shortcut, and Escape exit are available. |
| 6 | Run, pause, resume, replay, or reset | Healthy | Playback labels and disabled states follow the actual run state; controls lock while evidence is captured. |
| 7 | Read evidence and explain the result | Healthy | Confidence calibration, measured metrics, chart, explanation jump, AI feedback, and labeled offline fallback are present. |
| 8 | Change one variable and predict again | Healthy | The declared variable is applied from the pre-run baseline; unrelated values stay constant and tested controls cannot be edited accidentally. |
| 9 | Review completion | Healthy | Completion distinguishes matched/revised outcomes and shows mastery trajectory, confidence, evidence, changed variable, and held constants. |
| 10 | Leave or restart | Healthy | Header/home exit requires confirmation; explicit “Build another world” restarts immediately. |
| 11 | Use the app on a phone viewport | Healthy | Landing and lab measured 390 px wide with no horizontal document overflow. |

## Control audit

The following advertised controls were checked in code and covered by the updated user-flow suite:

- Brand/home and New experiment
- Grade 8–10 and 11–12
- Starter questions, question input, character limit, and Build my world
- Add, replace, and remove diagram
- Three validated experiment cards and closing CTA
- Prediction choices and confidence slider
- Lock prediction and run
- Zoom in, zoom out, recenter, reset simulation, expand, Escape, `F`, and `0`
- Variable stepper buttons and sliders, including reserved/tested-variable locking
- Pause, resume, replay, and reset experiment
- Clear run
- Explain this result, Check my explanation, and offline rubric fallback
- Change one variable
- Build another world
- Leave confirmation cancel/confirm

## `claude/compiler` migration decision

`main` remains the source of truth. The useful compiler-branch UX was ported deliberately rather than merging the branch wholesale because `claude/compiler` contains a different generic-model and AI architecture.

| Compiler-branch capability | `main` status |
| --- | --- |
| Correct Ask → Predict → Test → Evidence → Explain → Transfer rail | Ported |
| Exit confirmation and focus handling | Ported |
| Confidence preserved through evidence and completion | Ported |
| Evidence calibration note and explanation jump | Ported |
| Completion state and Run 1 vs Run 2 comparison | Ported |
| Controlled-variable reservation | Ported |
| Scientific measurement legend | Ported |
| Skip link, status announcements, expanded-view focus management | Ported |
| Question limit and starter prompts | Ported with mechanics-safe prompts |
| Generic compiler model program / `GeneratedScene` architecture | Not ported; intentionally leaves `main` AI/API behavior unchanged |

## Visual evidence

### Before

- [Landing](app-audit-2026-07-16/01-landing.png)
- [Prediction workspace](app-audit-2026-07-16/02-projectile-prediction.png)
- [Expanded 3D view](app-audit-2026-07-16/03-expanded-simulation.png)
- [Evidence](app-audit-2026-07-16/04-evidence.png)
- [Completion](app-audit-2026-07-16/07-completion.png)

### After

- [Updated landing](app-audit-2026-07-16/08-updated-landing.png)
- [Zoomed prediction workspace](app-audit-2026-07-16/09-updated-prediction-zoomed.png)
- [Confidence-calibrated evidence](app-audit-2026-07-16/10-updated-evidence.png)
- [Run comparison completion](app-audit-2026-07-16/11-updated-completion.png)
- [Phone landing](app-audit-2026-07-16/12-mobile-landing.png)
- [Phone lab](app-audit-2026-07-16/13-mobile-lab.png)

## Validation

- TypeScript: pass
- ESLint: pass
- Production build: pass
- Unit/API/physics suite: 257 tests pass
- Dependency audit: 0 known vulnerabilities after pinning patched PostCSS
- Browser console: no app errors in the improved local journey
- Manual browser journey: landing → projectile prediction → evidence → offline feedback → transfer → completion
- Responsive browser check: 390 px landing and lab, no horizontal overflow

## Remaining app-only risks

1. Low-end devices may render the WebGL scene more slowly; the app already supplies a loading state, software-friendly timing cap, and WebGL fallback.
2. The AI provider still depends on deployment credentials/gateway availability. This was explicitly outside the scope of this pass; the existing labeled validated-demo and offline-rubric fallbacks remain intact.
3. `claude/compiler` is divergent and cannot be fast-forwarded safely from `main` without first resolving its incompatible history. It must not be force-pushed.

