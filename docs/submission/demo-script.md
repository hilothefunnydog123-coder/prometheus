# Demo recording script — target 1:52 (hard cap 1:55)

Recorded at 1440×900, production build, notifications off, fresh browser
profile (mastery must start at 25%). Narrator: one team member, natural
student voice — read the narration column aloud once with a stopwatch before
recording; total spoken word count is ~255 words ≈ 1:42 at a relaxed pace,
leaving ~10 s of breathing room inside a 1:52 video.

**Primary path** uses a typed question with the live provider.
**Backup path** (same narration, zero provider calls) is in the second table
— rehearse it first; it is deterministic and cannot fail.

## Primary script (live provider)

| Time | On-screen action | Spoken narration | Expected result | Backup if provider is slow/down |
| --- | --- | --- | --- | --- |
| 0:00–0:08 | Landing page already open. Cursor moves to the question box. | "My physics homework asks: a two-kilogram ball and a ten-kilogram ball are dropped from the same height — which one lands first? Instead of googling it, I'm asking Counterfactual Lab." | Landing hero + "CREATE AN EXPERIMENT" console visible. | Same (landing needs no provider). |
| 0:08–0:18 | Type "A 2 kg ball and a 10 kg ball are dropped from the same height. Which lands first?", keep grade band 8–10, click **Build my world**. | "I type the question, pick my grade, and hit Build my world. The AI compiles it into a real experiment — and checks the physics before I ever see it." | Compiler overlay (Reading → Building → Validating), then the 3D drop lab in the Predict step. | Click the first example card "Do heavier objects fall faster?" instead — identical overlay and lab, bundled spec, no network. |
| 0:18–0:28 | Select the WRONG choice — the heavy sphere first. Nudge the confidence slider up. Click **Lock prediction & run**. | "Before anything moves, I have to commit. Honestly? I think the heavy one wins. Locking it in." | Choice selected; button arms; run starts. **First simulation is on screen by 0:28.** | Same actions on the bundled spec. |
| 0:28–0:40 | Both spheres fall (~1.3 s), camera untouched. Evidence panel appears. | "Three… two… one. They hit together. At exactly the same time." | Evidence step: "What the world showed", both impact metrics equal. | Same — bundled Galileo Drop shows 1.28 s and 1.28 s. |
| 0:40–0:55 | Slowly move cursor along the height-vs-time chart; hover the equal impact metrics; the "YOUR PREDICTION" recap stays visible. | "The notebook keeps my wrong prediction right next to the evidence — same curve, same impact time, down to the hundredth of a second. Mass didn't matter." | Synchronized chart + numeric metrics + recap of the wrong prediction in one frame. | Same. |
| 0:55–1:10 | Type the explanation: "Gravity pulls harder on the heavy ball but it is also harder to accelerate, so it cancels." Click **Check my explanation**. Feedback panel appears. | "Now I explain it in my own words: gravity pulls harder on the heavy ball, but it's also harder to accelerate — it cancels out. The AI grades my explanation against a rubric and gives me a hint. It never just hands me the answer." | Rubric criteria light up, feedback + hint shown, misconception named: "Heavier means faster". | Same — offline grading uses the deterministic rubric heuristic; feedback still appears. |
| 1:10–1:25 | Click **Change one variable**. The counterfactual card announces air resistance (ρ becomes 1.2). Select "the heavy sphere first" — correct this time. Click **Lock prediction & run**. | "Here's my favorite part. One variable changes: the air turns on. Same spheres, same height. This time I say the heavy one wins — because drag hits the light ball harder." | Environment badge flips to "Air (Earth)". Run 2 of 2 starts. | If the generated experiment's counterfactual is not air resistance, you are on the wrong path — restart on the backup (bundled) spec, whose counterfactual is always "Now let the air interfere". |
| 1:25–1:38 | Spheres fall through air; orange lands first; completion panel appears. | "And — yes. The orange one lands first. Same world, one change, opposite result. And I can say exactly why." | "Mental model revised / You didn't memorize it. You tested it." | Same. |
| 1:38–1:50 | Hover the mastery card (First prediction ↺, Transfer test ✓). | "The mastery tracker watched all of it. I started at twenty-five percent, dropped when I guessed wrong, and earned my way back to fifty-eight. That's not a quiz score — that's my mental model, updated." | Mastery bar at 58% with both events listed. | Same — numbers are Bayesian Knowledge Tracing and reproduce exactly on a fresh profile. |
| 1:50–1:53 | Cut to the landing hero (or hold the completion panel). | "Counterfactual Lab: ask a question, change the world, prove it." | End card. | Same. |

## Backup script (offline / fixture mode — same narration, byte-for-byte)

Use when the provider is unavailable, slow, or unrehearsed. Run the server
with no `FEATHERLESS_API_KEY`. Every visual beat matches the primary path.

| Time | Delta from primary path | Guaranteed result |
| --- | --- | --- |
| 0:00–0:08 | None. | Landing renders identically offline. |
| 0:08–0:18 | Instead of typing, click example card 01 — "Do heavier objects fall faster?" (you may still type the question first for camera realism; the card click is what compiles). | Bundled "The Galileo Drop" spec loads through the same compiler overlay. No provider call is made. |
| 0:18–0:28 | None — pick the heavy sphere, lock and run. | Deterministic: vacuum drop, 8 m. |
| 0:28–0:40 | None. | Impact metrics read exactly **1.28 s and 1.28 s**. |
| 0:40–0:55 | None. | Height-vs-time chart, both curves overlapping. |
| 0:55–1:10 | None — explanation grading falls back to the deterministic rubric heuristic. | Rubric feedback + hint still render. |
| 1:10–1:25 | None — the bundled counterfactual is exactly "Now let the air interfere" (air density 0 → 1.2). | Environment badge flips to "Air (Earth)". |
| 1:25–1:38 | None. | Heavy (orange) sphere lands first — computed by the deterministic drag model. |
| 1:38–1:50 | None. | Fresh profile: mastery 25% → 18% (wrong) → 58% (correct transfer) — exact BKT arithmetic. |
| 1:50–1:53 | None. | Same closing line. |

## Hard requirements checklist for the recording

- [ ] First simulation running on screen before **0:30**. ✔ by design (0:28)
- [ ] Textbook-style falling-object question. ✔ (0:00 narration + typed text)
- [ ] Deliberately incorrect learner prediction. ✔ (0:18 — heavy sphere first in vacuum)
- [ ] Synchronized visual + numerical evidence. ✔ (0:40 — chart + equal impact times)
- [ ] Misconception explained. ✔ (0:55 — "heavier means faster" named and countered)
- [ ] One-variable air-resistance counterfactual. ✔ (1:10 — only airDensity changes)
- [ ] Ends on the learner's changed mental model. ✔ (1:38 — mastery narrative)
- [ ] Final line, exactly: **"Counterfactual Lab: ask a question, change the world, prove it."**
- [ ] Total duration between 1:50 and 1:55.

## Timing notes

- Narration is ~255 words. At a relaxed 150 words/minute that is ~1:42 of
  speech inside a 1:52 video — do not rush; the simulations carry the pauses.
- If the live compile takes more than ~8 s at 0:08, you will miss the 0:30
  simulation deadline: abort and restart the recording on the backup path.
- Rehearse the backup path first. It has zero nondeterminism: 1.28 s impacts,
  air counterfactual, 25 → 18 → 58 mastery, every time, on a fresh profile.
