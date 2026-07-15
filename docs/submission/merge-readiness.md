# Merge readiness — submission package audit

Prepared by the submission/demo-package owner. **No application code was
modified.** Everything here is from read-only inspection; file paths are
clickable evidence, not changes.

## Commits inspected

| Ref | SHA | Notes |
| --- | --- | --- |
| `origin/codex/integration-ui` (base of this package) | `23542fdc3968282a20af621b2015bd4d9c7d253e` | "fix: harden complete learning experience" — full merged app |
| `origin/codex/physics-validation` | `8ce8ac4ebe3df5e43881623ca85ccd944c508f11` | **Already merged** into integration-ui (merge commit `68127a7`) |
| `origin/codex/ai-hardening` | `de84f478c13d6a6856aa36692bad220405c52dc2` | **Already merged** into integration-ui (merge commit `28cb22a`) |
| `claude/integration-backend` | `6ed50eac15e724d045223bdc26ebf4502bba5a1e` | **NOT merged**; shares the boundary-contract ancestor `c65043b` |
| `main` | `57f03e1d2257859c74c7950ce18b97c8125d5f60` | Ancestor of integration-ui (via `c65043b`) — can fast-forward |
| Boundary contract commit | `c65043bb060ca68c9843b2984ac2f4e1001bfcac` | Common ancestor of all active work |

Verified at `23542fd`: `npx tsc --noEmit` ✅ · `npm test` ✅ (188/188, no
live provider calls) · `npm run build` ✅.

## Claims that depend on unmerged code (label or cut)

| Claim | Where it lives | Status |
| --- | --- | --- |
| Single retry on transient provider errors (429/5xx, 250 ms) | `claude/integration-backend` @ `2fb7556`, `src/lib/ai/featherless-client.ts` | ❌ Not in integration-ui — its hardened client has richer error taxonomy (cancelled / rate-limited / network-error) but no retry |
| TTL/LRU compile-response cache | `claude/integration-backend` @ `6ed50ea`, `src/lib/ai/compile-cache.ts` + compile route wiring | ❌ Not in integration-ui |
| Model defaults `Qwen/Qwen3-32B` + `google/gemma-3-27b-it` | `claude/integration-backend` `src/lib/ai/config.ts` | ❌ integration-ui ships `meta-llama/Meta-Llama-3.1-8B-Instruct` + `Qwen/Qwen2.5-VL-7B-Instruct` — see discrepancy #3 |

All three are excluded from the Devpost copy and demo script, or explicitly
marked branch-dependent.

## Contract / naming discrepancies

1. **Two ExperimentSpec contracts coexist on integration-ui.** The renderer
   contract `src/lib/contracts/experiment.ts` is authoritative, but the
   legacy contract `src/lib/ai/contracts/experiment-spec.ts` (plus
   `evaluation.ts`) still exists and is imported by
   `src/lib/ai/legacy-validation.ts` and referenced from
   `src/lib/ai/validation.ts`. Functional (tests pass), but "the only public
   contract" claim is only true with the qualifier "legacy modules retained".
2. **`src/lib/fixtures/**` is dead code.** It contains the *pre-renderer*
   fixture shapes (`fixture-drop-classic`, `parameters`/`simulation` fields)
   importing the legacy contract, and **nothing outside that directory
   imports it** (verified by grep). Real fallbacks are
   `src/lib/ai/validated-examples.ts` → `src/components/lab/demo-experiments.ts`
   (`galileo-drop`, `projectile-arc`, `pendulum-period`). Recommend delete or
   port after merge; until then any docs mentioning "fixtures in
   src/lib/fixtures" are wrong.
3. **Model-default regression/divergence.** integration-ui's
   `src/lib/ai/config.ts` defaults differ from `claude/integration-backend`'s
   restored planned defaults (`Qwen/Qwen3-32B` text, `google/gemma-3-27b-it`
   vision). One side must be chosen at merge; submission copy avoids naming
   defaults as product facts.
4. **Physics semantics superseded.** The canonical engine
   (`src/lib/physics/evidence.ts`) uses: drop tie 1/30 s, **fixed 0.92 m**
   projectile target radius, ±1% pendulum period, nonlinear damped pendulum,
   3600 s solver safeguard. The older engine on `claude/integration-backend`
   (drop tie 0.035 s, `max(0.8 m, 5.5%)` target tolerance, small-angle
   pendulum, 20 s cap) is superseded — do not cherry-pick it back during
   merge. `src/lib/ai/deterministic-outcomes.ts` on integration-ui correctly
   re-exports the physics module.
5. **`testChange` semantics tightened.** integration-ui *forbids*
   `prediction.testChange` on drop/projectile base predictions
   (`src/lib/ai/validation.ts` — "base drop/projectile predictions must
   describe the rendered base scene"); the backend branch merely allowed it.
   The integrated rule is stricter and internally consistent; adopt it.

## Documentation needing revalidation after integration

- **`README.md` is stale** (predates the renderer contract): describes the
  old `ExperimentSpec` shape (`parameters`/`simulation`), old fixture
  layout, old evaluator response, and old model defaults. Replace with
  `docs/submission/readme-proposal.md` after the final merge.
- `src/lib/physics/AI_INTEGRATION.md` — its three integration steps appear
  done on integration-ui (re-export in place; testChange rule present; test
  expectations updated). Re-verify after merge, then mark the checklist
  complete or delete the instructions.
- This submission package itself: screenshots and the "188 tests" figure are
  pinned to `23542fd`; retake/re-run if the UI or suite changes before
  submission.

## Code problems found (NOT fixed — outside package ownership)

1. **Evidence chart tooltip prints unformatted floats.**
   File: `src/components/lab/EvidenceChart.tsx`. Behavior: hovering (and the
   default tooltip state) renders values like `Object A height :
   6.25777777777777`. Visible in `docs/assets/submission/evidence.png`
   (kept — screenshots must be unedited). Recommended fix: a tooltip
   `formatter`/`valueFormatter` applying `toFixed(2)` plus the measurement
   unit. Owner: frontend (Codex).
2. **Duplicate x-axis tick labels on the evidence chart.** Same file: ticks
   render as `0.3 0.3 … 0.9 0.9 1.1 1.1` because tick values are rounded to
   one decimal independently. Recommended fix: fixed tick count with a
   consistent formatter, or dedupe formatted ticks. Owner: frontend (Codex).
3. **Dead legacy modules** (`src/lib/fixtures/**`,
   `src/lib/ai/contracts/experiment-spec.ts`, `src/lib/ai/contracts/evaluation.ts`,
   `src/lib/ai/legacy-validation.ts` if it exists only to serve them).
   Behavior: compiles and tests fine, but misleads readers about where
   fallbacks live. Recommended fix: delete after confirming no imports, or
   fold their tests into the renderer-contract suites. Owner: AI/backend.
4. **Rules page unreachable from tooling** (not a code bug):
   `https://prometheus-july-ai-challenge.devpost.com/rules` returns
   Cloudflare 403 via fetch and the sandbox proxy blocks the domain in the
   browser. All criterion mappings in this package are labeled accordingly
   and must be human-verified.

## Recommended final merge order

1. **Nothing to do for `codex/physics-validation` and `codex/ai-hardening`**
   — both are already merged into `codex/integration-ui` (verified by
   `git merge-base --is-ancestor`).
2. **Port the two remaining `claude/integration-backend` commits onto
   `codex/integration-ui`** — `2fb7556` (transient retry) and `6ed50ea`
   (compile cache) — as fresh cherry-picks/ports, adapting to the hardened
   client's error taxonomy. Do NOT merge that branch wholesale: its physics
   engine, fixtures, validation semantics, and README are superseded
   (discrepancies #2, #4, #5). Decide the model-default question (#3) in the
   same change.
3. **Clean-up commit on `codex/integration-ui`**: delete dead legacy modules
   (#2 above), adopt `docs/submission/readme-proposal.md` as `README.md`,
   and apply the two chart fixes if the frontend owner agrees.
4. **Fast-forward `main` to the result** (`git merge --ff-only`) — `main`
   (`57f03e1`) is an ancestor, so no merge commit and no
   `--allow-unrelated-histories` is needed.
5. **Merge `claude/submission-package`** (this branch — only
   `docs/submission/**` and `docs/assets/submission/**`) — it conflicts with
   nothing by construction.
6. Tag the deployed commit, deploy, then complete
   `docs/submission/demo-day-checklist.md` (fill in production URL +
   deployed SHA, retake screenshots only if the UI changed).
