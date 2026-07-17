# Design QA — Counterfactual Lab

## Source of truth

- Selected design: `/Users/anayagarwalla/.codex/generated_images/019f66bf-d4da-7941-80ce-b5268588e733/exec-227eb694-688a-4bea-90e8-eee4200d0001.png`
- Implementation capture: `/Users/anayagarwalla/prometheus/design-qa-implementation.png`
- Full comparison: `/Users/anayagarwalla/prometheus/design-qa-comparison.jpg`
- Focused notebook comparison: `/Users/anayagarwalla/prometheus/design-qa-focus.jpg`
- Mobile evidence capture: `/Users/anayagarwalla/prometheus/design-qa-mobile.png`

## Verified state

- Viewport: 1440 × 1024 desktop; 390 × 844 mobile
- Scenario: Galileo Drop, run 1 evidence evaluated, counterfactual action available
- Data: live simulation evidence and height-over-time chart
- Evaluation: production `/api/evaluate` response, local heuristic source, 100% rubric match for a strong causal explanation
- Browser geometry: desktop `scrollWidth = 1440`; mobile `scrollWidth = 390`
- Browser console: no errors in the clean production flow

## Visual comparison

The implementation preserves the selected design's defining structure: dark instrument-panel shell, continuous six-stage progress rail, large simulation/evidence split, experiment telemetry, playback controls, controlled-variable strip, persistent evidence notebook, chart-led observation, green validated-insight treatment, orange counterfactual action, and mastery footer.

The focused comparison confirms that prediction recap, observation, chart, validated insight, and change-one-variable action retain the same reading order and emphasis. The implementation uses the application's real experiment values, live WebGL scene, and responsive chart rather than static reference values.

## Comparison history

1. **P1 — Lab opened at the landing page's prior scroll position.** Added a phase-change scroll reset so every experiment enters at the question and progress rail. Resolved.
2. **P1 — Post-processing produced an intermittent WebGL runtime error during hot reload.** Removed the unstable effect-composer layer and retained native scene lighting, emissive materials, shadows, and telemetry. Clean production console verified. Resolved.
3. **P2 — Evidence capture left the spheres resting on the floor, weakening parity with the selected evidence view.** Reset the visual scene after evidence capture while preserving measurements and replay data. Resolved.
4. **P2 — Offline explanation grading undervalued accurate paraphrases.** Expanded the deterministic rubric to recognize family-specific vocabulary, causal language, and observed-evidence language; added regression coverage. Production API now returns a full rubric match for the verified explanation. Resolved.
5. **P2 — Narrow layouts risked compressing the notebook beside the simulation.** Stacked the simulation, controls, and notebook; verified 390 px with no horizontal overflow. Resolved.

## Remaining differences

- **P3:** The generated source uses cinematic particle textures and decorative light trails. The implementation favors a stable, interactive WebGL scene with clean emissive materials so physics playback remains reliable across desktop and mobile.
- **P3:** The implementation's notebook typography is slightly denser to keep the complete evidence-to-counterfactual flow visible at 1024 px height.

No remaining P0, P1, or P2 issues were found.

## Focused verification — progress rail connector

- Source screenshot: `/var/folders/gt/580h0wx52v1147kb41bv7s4c0000gn/T/TemporaryItems/NSIRD_screencaptureui_HghnqS/Screenshot 2026-07-15 at 1.33.09 PM.png`
- Implementation screenshot: `/tmp/prometheus-stepper-fixed.png`
- Focused source: `/tmp/prometheus-stepper-reference-normalized.png`
- Focused implementation: `/tmp/prometheus-stepper-fixed-crop.png`
- Viewport: 1292 × 900
- State: Galileo Drop, run 1 evidence captured; `Evidence` is the current progress step

### Comparison history

1. **P2 — The connector before “Change” crossed the “Evidence” label.** The fixed-width steps placed the following connector 11.45 px inside the preceding label; smaller collisions also affected “Predict” and “Change.” Replaced the fixed-width desktop rail with content-sized steps and dedicated connector gaps. Resolved.
2. **Post-fix evidence.** Every desktop label has 5 px of clear space before the following connector at 1292 px and 4 px at 1200 px. At 900 px the compact icon-only rail has zero horizontal overflow. Resolved.

Typography, colors, copy, and semantic state styling remain unchanged. Spacing now follows the intended circle → label → connector rhythm. No imagery or icon assets were affected, and the focused source/implementation comparison found no remaining P0, P1, or P2 mismatch related to this correction.

## Focused verification — hidden projectile outcome

- Source problem screenshot: `/var/folders/gt/580h0wx52v1147kb41bv7s4c0000gn/T/TemporaryItems/NSIRD_screencaptureui_lYFyng/Screenshot 2026-07-16 at 8.38.49 PM.png`
- Corrected implementation screenshot: `/Users/anayagarwalla/prometheus/design-qa-projectile-hidden.jpg`
- Normalized comparison: `/Users/anayagarwalla/prometheus/design-qa-projectile-comparison.jpg`
- Source viewport: 1790 × 866; implementation viewport: 1280 × 720
- State: `The Hidden Second Motion`, run 1, prediction not selected, simulation ready

The source screenshot documents the P1 defect: an orange dashed trajectory crosses the target before the learner has locked a prediction, visually revealing the landing outcome. The normalized full-canvas comparison shows the same production experiment and pre-prediction state after the fix, with the target and launch-angle reference retained but the calculated trajectory absent. A separate focused crop was unnecessary because the trajectory spans the primary canvas and is clearly legible in the normalized comparison.

### Comparison history

1. **P1 — Projectile trajectory revealed the answer before prediction.** Outcome-guide visibility is now gated by both captured evidence and an evidence-bearing phase. The WebGL canvas exposes the same reveal state to browser coverage, preventing a regression that visually gives away the answer. Resolved.
2. **Post-fix interaction evidence.** Browser verification recorded `hidden` before prediction, `hidden` during simulation playback, and `revealed` only after the `What the world showed` evidence view appeared. The complete projectile prediction/evidence/counterfactual browser test passed. Resolved.

Fonts and typography, spacing and layout rhythm, colors and tokens, image quality, and learner-facing copy remain unchanged from the approved interface. The correction removes only the answer-revealing guide during hypothesis formation and playback; no remaining P0, P1, or P2 issue was found in this state.

final result: passed
