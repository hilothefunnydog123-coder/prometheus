# Demo-day checklist

Work top to bottom the morning of recording/judging. Boxes with `____` are
fill-in fields — this package intentionally does not invent a production URL
or deployed commit.

## Deployment

- [ ] Production URL: `____________________` (fill in once deployed; verify it
      is reachable from a phone network, not just the venue Wi-Fi)
- [ ] Exact deployed commit SHA: `____________________`
      (`git rev-parse HEAD` on the deploy branch — must match what judges
      will browse on GitHub)
- [ ] The deployed commit contains the final merge (see
      `merge-readiness.md` → recommended merge order) — not a stale branch

## Environment variables (server-side only)

- [ ] `FEATHERLESS_API_KEY` set in the hosting provider's secret store —
      never in the repo, never in `NEXT_PUBLIC_*`
- [ ] `FEATHERLESS_TEXT_MODEL` / `FEATHERLESS_VISION_MODEL` — either
      explicitly set, or you have confirmed which defaults the deployed
      commit ships (defaults differ between branches; merge-readiness #3)
- [ ] Optional: `FEATHERLESS_BASE_URL`, `FEATHERLESS_TIMEOUT_MS` (default
      20000 ms) reviewed for venue network latency

## Provider health

- [ ] `GET <production-url>/api/health` returns
      `{"status":"ok","aiProviderConfigured":true}`
- [ ] If `aiProviderConfigured` is `false`: the demo still works — switch to
      the explicit validated-demo script and say the disclosure line honestly
- [ ] Provider warm-up: ~10 minutes before recording, run one real compile
      (typed question) end-to-end and one `/api/evaluate`; note the compile
      latency — if it exceeds ~8 s, pre-commit to the backup path

## Explicit validated-demo path (rehearse this FIRST)

- [ ] With the key removed locally (`npm run build && npm run start`, no
      provider credentials): each example card shows the provider notice and a
      separate **Open the validated … demo** action
- [ ] The original custom question is never shown as the title of the validated
      demo; the demo uses its canonical question
- [ ] AI feedback fails honestly, and **Continue with an offline rubric** is a
      separate action whose result says **Offline rubric check**
- [ ] Galileo Drop shows 1.28 s / 1.28 s impacts in vacuum
- [ ] Air counterfactual lands the orange (heavy) sphere first
- [ ] Fresh profile mastery reads 25% → 18% → 58% along the demo path

## Browser / WebGL

- [ ] Chrome or Edge, current stable, hardware acceleration ON
      (`chrome://gpu` shows WebGL2 hardware-accelerated — SwiftShader
      software rendering will stutter on camera)
- [ ] The 3D scene orbits smoothly on the recording machine at 1440×900
- [ ] Zoom at exactly 100%; device pixel ratio noted for crisp capture

## Recording hygiene

- [ ] Screen resolution 1440×900 (or record a 1440×900 window region)
- [ ] OS notifications: Do Not Disturb ON (macOS Focus / Windows Focus
      Assist); Slack/Discord/mail quit entirely
- [ ] Browser: clean profile, no extensions, no bookmarks bar, kiosk or
      app-mode window so no tab strip/URL bar appears in frame
- [ ] Clear site data for the app origin before the take (mastery must start
      at 25%)
- [ ] No secrets or personal paths anywhere on screen (dock, wallpaper,
      terminal history)

## Audio

- [ ] External or headset mic, input level tested against the narration's
      loudest line ("And — yes!")
- [ ] Record narration and screen in one take if possible; otherwise capture
      screen first, narrate over it (script timings in `demo-script.md`)
- [ ] Play back the first 15 seconds before recording the full take

## Recording backup

- [ ] Two takes minimum: one primary (live provider), one backup (validated demo
      path) — keep both files
- [ ] Second capture method running (OS screen recorder alongside OBS, or a
      second machine) so a codec failure cannot destroy the only take
- [ ] Raw takes uploaded to cloud storage immediately after recording

## Video duration

- [ ] Final cut between **1:50 and 1:55** (script targets 1:52 and the official
      maximum is 2:00)
- [ ] Ends with the exact line: "Counterfactual Lab: ask a question, change
      the world, prove it."
- [ ] Confirm the export itself is no longer than 2:00; judges will not watch
      anything after the two-minute mark

## Repository

- [ ] Repository visibility: public (open an incognito window and load the
      repo + the three screenshot paths under `docs/assets/submission/`)
- [ ] Default branch shows the final merged code, not a work branch
- [ ] No `.env`, keys, or provider tokens anywhere in history (`git log -p
      --all -S FEATHERLESS_API_KEY` shows only code references, no values)

## Devpost fields

- [ ] Copy from `devpost-submission.md` (title, tagline, all sections)
- [ ] Map the final entry to the verified criteria: Educational Impact,
      Creative Use of AI/ML, Technical Execution, and Pitch & Demo
- [ ] Submit before July 30 at 11:59 PM; the rules state no extensions (submit
      early because the page does not state a timezone in the rules text)
- [ ] Video URL uploaded and set public/unlisted per the rules
- [ ] Repo link, try-it-out link (production URL), and the three screenshots
      attached
- [ ] Team members added; submission actually SUBMITTED, not draft

## Final smoke test (T-minus 30 minutes)

- [ ] `GET /api/health` → `{"status":"ok", ...}` on production
- [ ] Landing loads in under 3 s on venue network
- [ ] One full example-card run: predict → run → evidence → explain →
      explicit offline rubric → counterfactual → complete, no application errors
- [ ] One typed-question compile (if provider configured) returns an
      experiment or a *disclosed* fallback — either is demoable
- [ ] Off-topic question ("balance chemical equations") returns the polite
      422 message naming the six families
