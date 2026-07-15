# Merge readiness — release candidate

## Integrated history

| Work | Commit/reference | Status |
| --- | --- | --- |
| Current remote baseline | `origin/main` / `origin/codex/integration-ui` at `1fe8a0a` | Integrated |
| Physics validation | `8ce8ac4` through merge `68127a7` | Integrated |
| AI/API hardening | `de84f47` through merge `28cb22a` | Integrated |
| Question-aligned generation | original `653aab0`, transplanted as `aec81fc` | Integrated on release candidate |
| Claude screenshots | original `0dcf6ac`, transplanted as `72dac21` | Integrated and then refreshed |
| Claude submission copy | original `1f290f8`, transplanted as `7a3e335` | Integrated and revalidated |

The release work is isolated on `agent/counterfactual-release-candidate`.
The original checkout and completed contributor worktrees were not modified.

## Decisions resolved during release integration

1. **No misleading fallback:** custom questions require generated provenance.
   Provider failure returns a validated example, but the UI keeps the custom
   question intact and requires an explicit second action before opening the
   example under its own canonical question.
2. **Offline feedback is opt-in:** AI grading is tried first. A rules-based
   rubric is available only after a visible failure and its result is labeled
   `Offline rubric check`.
3. **Deterministic physics remains authoritative:** model answer keys are
   overwritten by `src/lib/physics/deterministic-outcomes.ts`.
4. **No wholesale `claude/integration-backend` merge:** its cache/retry work is
   optional future scope and its older physics/validation semantics are
   superseded.
5. **README proposal adopted carefully:** stale contributor, legacy-contract,
   fallback, model, and test-count claims were replaced with release behavior.
6. **Evidence chart issue closed:** continuous time scale removes duplicate
   rounded ticks; tooltip values now include bounded precision and units.
7. **E2E isolation closed:** `PLAYWRIGHT_PORT` prevents tests from reusing a
   different checkout's server on port 3000.

## Verification completed

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test -- --reporter=dot` — 19 files, 201 tests passed.
- `npm run build` — passed; `/`, `/api/compile`, `/api/evaluate`, and
  `/api/health` built successfully.
- `PLAYWRIGHT_PORT=3020 npm run test:e2e` — four flows passed:
  drop, projectile, pendulum, and full provider-outage recovery.
- Production browser walkthrough at 1440×900 — explicit demo selection,
  incorrect prediction, evidence, explicit offline rubric, counterfactual,
  and 58% completion verified.
- Provider credentials were removed for offline verification; no live AI calls
  were made by automated tests.

## Rules verification completed

- Official deadline: July 30, 2026 at 11:59 PM, no extensions.
- Video maximum: two minutes; the script targets 1:52.
- Team size: one to four people.
- Official criteria: Educational Impact, Creative Use of AI/ML, Technical
  Execution, and Pitch & Demo—25 points each.

## Remaining external blockers

- Production deployment needs server-side provider configuration and a real
  live-provider smoke test.
- Production URL and deployed commit SHA remain blank until deployment.
- Browser diagnostics contain two non-blocking dependency deprecation warnings
  from Three.js/WebAssembly initialization.

## Recommended final order

1. Review the draft release-candidate PR and its exact diff.
2. Merge the release candidate into `main` only after approval.
3. Deploy that exact commit and configure provider secrets server-side.
4. Run one live compile, one live evaluation, and the explicit outage-demo path.
5. Fill in the production URL and deployed SHA in the checklist.
6. Record the demo, complete the verified Devpost fields, and submit.
