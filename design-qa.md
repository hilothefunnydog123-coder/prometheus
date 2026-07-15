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

final result: passed
