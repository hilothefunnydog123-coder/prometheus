# AI compiler integration

The AI compiler may select bounded scene parameters and write instructional
text. Numerical trajectories, semantic outcomes, and `correctOutcomeKey`
values must come from `deterministic-outcomes.ts`.

After merging `codex/physics-validation` with `codex/ai-hardening`, make these
small integration-branch changes:

1. Replace the implementation of `src/lib/ai/deterministic-outcomes.ts` with:

   ```ts
   export * from "@/lib/physics/deterministic-outcomes";
   ```

   This removes the duplicate semi-implicit Euler solver, the distance-scaled
   projectile hit tolerance, and the small-angle-only pendulum comparison.

2. In `src/lib/ai/validation.ts`, function `checkCounterfactuals`, require
   `counterfactual.prediction.testChange`, when present, to match
   `counterfactual.change` for every family. Remove the current
   `spec.scene.family !== "pendulum"` exception. The renderer already rejects
   mismatched changes in `applyCounterfactual`; compiler validation should
   reject them before returning a spec.

3. Update `src/lib/ai/deterministic-outcomes.test.ts` to assert the canonical
   renderer semantics:

   - projectile hit tolerance is the fixed 0.92 m target radius;
   - release angle and damping use the nonlinear/damped pendulum model;
   - maximum contract values remain valid up to the 3,600 s solver safeguard,
     rather than being rejected by an undocumented 20 s physics limit.

The prompt may still ask the model to prefer concise experiments under 20 s as
an authoring heuristic. That preference must not redefine the physics contract
or the server-computed outcome.
