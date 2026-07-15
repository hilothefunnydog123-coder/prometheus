# Release status — verified facts only

Audited from `codex/release-finalization` (based on `main` @
`dca2fe07fb7b3927ffddf907681f6c94b0cbf4a3`, the PR #2 merge). Every statement
below was verified in this audit; nothing is aspirational. Items that require
a human are listed at the end.

## Deployment

- **No deployment exists yet.** There is no `netlify.toml`/`vercel.json`, no
  deploy workflow in `.github/workflows/`, no GitHub Pages, and no homepage
  URL in the repository metadata.
- The code is **Netlify AI Gateway ready**: `src/lib/ai/config.ts` uses an
  explicit `FEATHERLESS_API_KEY` when present and otherwise falls back to the
  `OPENAI_API_KEY`/`OPENAI_BASE_URL` pair Netlify injects, so a deployed site
  gets live inference without a checked-in secret.
- **Blocker:** linking a hosting project requires the account owner (new
  service creation is out of scope for automation). Until then, all
  deployed-app checks below were run against a **local production build**
  (`next build` + `next start`) of this exact code.

## Verification results (this audit)

| Check | Result |
| --- | --- |
| `npm ci` | ✅ clean install |
| `npm run lint` | ✅ 0 problems |
| `npm run typecheck` | ✅ |
| `npm test` | ✅ **212/212** across 20 files (all provider calls mocked) |
| `npm run build` | ✅ production build; routes `/`, `/api/compile`, `/api/evaluate`, `/api/health` |
| Playwright E2E (`npm run test:e2e`) | ✅ 4/4 — three family loops + provider-outage consent flow (provider mocked in-page; sandbox runs need `PLAYWRIGHT_CHROMIUM_EXECUTABLE` pointing at a preinstalled Chromium) |
| `git diff --check` | ✅ clean |
| Secret scan (tracked files, key patterns) | ✅ no hits; `.env*` untracked except `.env.example` |
| `npm audit` | ⚠️ 2 moderate advisories via `next`'s bundled `postcss` range; the advisory range covers all current Next 15 releases, so there is no non-breaking remediation — accepted for the hackathon, do not force-upgrade |

### Local production-server battery (offline, no provider key)

All responses verified by hand against `next start`:

- `GET /api/health` → `200 {"status":"ok","aiProviderConfigured":false}`
- Landing page → 200; the only console/network error in a full learning loop
  is the **intentional** `503 ai_not_configured` from `/api/evaluate` before
  the learner consents to the offline rubric.
- `/api/compile`: non-multipart → 415; malformed multipart → 400; missing
  prompt → 400; bad gradeBand → 400; GIF image → 415; >6 MB payload → 413;
  off-topic question → 422 naming the three families; supported question →
  200 validated example with `provenance.source: "validated-example"` and an
  explicit warning (never relabeled as a generated answer).
- `/api/evaluate`: no consent + no provider → honest 503; explicit
  `x-counterfactual-feedback-mode: heuristic` → 200 labeled offline rubric;
  invalid mode → 400.
- Full UI loop (drop family) through the real consent gates: example card →
  "Open the validated drop demo" → wrong prediction → evidence (1.28 s /
  1.28 s) → explanation → "Continue with an offline rubric" → counterfactual
  → completion; mastery 25% → 18% → 58% (exact BKT arithmetic).

## Live-provider verification

**Not performed.** No provider credentials exist in the audit environment
(`aiProviderConfigured: false`; no `FEATHERLESS_API_KEY`, no Netlify gateway
variables), and adding credentials is explicitly out of scope for automation.
The one-live-compile / one-live-evaluation check must be run by a human after
deployment (see below).

## Screenshots

`docs/assets/submission/{landing,evidence,counterfactual-complete}.png` were
**retaken in this audit** against this exact code (production build, offline,
1440×900, unedited) — the previous captures predated the consent flow and the
evidence-chart formatting fix. `evidence.png` now shows the formatted chart
values and the provenance disclosure banner.

## Changes made by this release pass

1. `.github/workflows/ci.yml` — `actions/checkout` and `actions/setup-node`
   bumped v4 → v5 (v4 runs on the deprecated Node 20 actions runtime).
2. `playwright.config.ts` — optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE`
   override so E2E can run in sandboxes with a preinstalled Chromium; unset
   (as in CI) the behavior is unchanged.
3. `src/app/globals.css` — the provenance disclosure (`.compiler-notice`)
   wraps instead of being ellipsis-clipped mid-sentence; regression-tested by
   a scrollWidth/clientWidth assertion in `tests/e2e/lab-flow.spec.ts`.
4. Screenshots retaken (above); this document added.

No public-contract (`src/lib/contracts/experiment.ts`) changes.

## Remaining risks

- **Hosting:** nothing is deployed; the demo currently requires
  `npm run build && npm run start` on a laptop. Offline mode is fully
  demoable by design.
- **Repository default branch is `claude/compiler`** (stale). Judges landing
  on the repo see old code — change the default branch to `main` in GitHub
  settings (human, one click, high priority).
- **Dependencies:** 2 moderate `npm audit` advisories (Next/postcss range,
  no non-breaking fix) — acceptable for the hackathon window.
- **Live model quality** is unverified end-to-end (no credentials in audit
  environment); the validator + deterministic physics bound the blast radius
  by design.
- Devpost rules page remains human-verify-only (unreachable from automation;
  see `judge-evidence-map.md`).

## Demo backup instructions (no provider, no network needed)

1. `npm ci && npm run build && npm run start`
2. Open `http://localhost:3000`, click example card 01.
3. Click **Open the validated drop demo** (explicit consent — say the honest
   line: "the AI compiler isn't configured here, so I'm choosing the
   validated demo").
4. Follow `docs/submission/demo-script.md` (backup table) — every number in
   it (1.28 s impacts, 25→18→58 mastery) reproduces deterministically on a
   fresh browser profile; consent to the offline rubric when prompted.

## Human-only actions before Devpost submission

1. Change the GitHub default branch from `claude/compiler` to `main`.
2. Link a Netlify (or equivalent) site to the repo and deploy `main`; then
   fill in the production URL + deployed SHA in
   `docs/submission/demo-day-checklist.md` and re-run its smoke test.
3. With credentials configured on the host, run one live compile and one
   live evaluation; confirm `provenance.source: "generated"` and rubric
   feedback, then record the result here.
4. Open the live rules page and re-verify the judging-criteria mapping in
   `docs/submission/judge-evidence-map.md`.
5. Record the demo video per `docs/submission/demo-script.md` (≤ 1:55).
6. Complete Devpost fields from `docs/submission/devpost-submission.md` and
   submit.
