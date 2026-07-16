"use client";

import { useEffect, useMemo, useState } from "react";
import type { EvaluationResult } from "@/lib/ai/contracts/evaluation";
import {
  requestCompile,
  requestEvaluation,
  type CompileResponse,
} from "@/lib/client/api";
import { formatQuantity, formatRelativeChange } from "@/lib/client/format";
import {
  clearMasteryRecord,
  loadMasteryRecord,
  saveMasteryRecord,
} from "@/lib/client/mastery-persistence";
import {
  emptyMasteryRecord,
  recordObservation,
  type MasteryRecord,
} from "@/lib/mastery/store";
import { compareCounterfactual, sampleTrajectory } from "@/lib/simulation";
import { ExperimentCanvas } from "./experiment-canvas";
import { MasteryPanel } from "./mastery-panel";
import { RubricPanel } from "./rubric-panel";

const EXAMPLES = [
  "Do heavy things really fall faster than light ones?",
  "What's the best angle to launch a water balloon?",
  "Why does a grandfather clock keep such steady time?",
];

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export function Lab() {
  // --- ask stage ---
  const [text, setText] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [experiment, setExperiment] = useState<CompileResponse | null>(null);

  // --- lab stage ---
  const [chosenOutcomeId, setChosenOutcomeId] = useState<string | null>(null);
  const [activeCfId, setActiveCfId] = useState<string | null>(null);
  const [explanation, setExplanation] = useState("");
  const [evaluating, setEvaluating] = useState(false);
  const [evalResult, setEvalResult] = useState<EvaluationResult | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);

  // --- mastery (localStorage-backed; loaded after mount to avoid
  //     hydration mismatches) ---
  const [mastery, setMastery] = useState<MasteryRecord>(emptyMasteryRecord);
  useEffect(() => {
    setMastery(loadMasteryRecord());
  }, []);

  const spec = experiment?.spec ?? null;

  const baseTrajectory = useMemo(
    () => (spec ? sampleTrajectory(spec, spec.parameters) : null),
    [spec],
  );
  const activeCf = useMemo(
    () => spec?.counterfactuals.find((cf) => cf.id === activeCfId) ?? null,
    [spec, activeCfId],
  );
  const patchedTrajectory = useMemo(() => {
    if (!spec || !activeCf) return null;
    return sampleTrajectory(spec, {
      ...spec.parameters,
      [activeCf.patch.parameter]: activeCf.patch.value,
    });
  }, [spec, activeCf]);
  const comparison = useMemo(
    () => (spec && activeCf ? compareCounterfactual(spec, activeCf) : null),
    [spec, activeCf],
  );

  const applyObservation = (conceptIds: readonly string[], correct: boolean) => {
    setMastery((previous) => {
      const next = recordObservation(previous, conceptIds, correct, {
        nowMs: Date.now(),
      });
      saveMasteryRecord(next);
      return next;
    });
  };

  const resetLabState = () => {
    setChosenOutcomeId(null);
    setActiveCfId(null);
    setExplanation("");
    setEvalResult(null);
    setEvalError(null);
  };

  const compile = async (question: string) => {
    if (compiling) return;
    const trimmed = question.trim();
    if (!trimmed) return;
    setCompiling(true);
    setCompileError(null);
    const result = await requestCompile(trimmed, imageFile);
    setCompiling(false);
    if (!result.ok) {
      setCompileError(result.message);
      return;
    }
    resetLabState();
    setExperiment(result.data);
  };

  const chooseOutcome = (outcomeId: string) => {
    if (!spec || chosenOutcomeId !== null) return;
    setChosenOutcomeId(outcomeId);
    applyObservation(
      spec.concepts,
      outcomeId === spec.prediction.correctOutcomeId,
    );
  };

  const submitExplanation = async () => {
    if (!spec || evaluating || explanation.trim().length === 0) return;
    setEvaluating(true);
    setEvalError(null);
    const result = await requestEvaluation(explanation.trim(), {
      family: spec.family,
      question: spec.explanationPrompt,
      concepts: spec.concepts.slice(0, 5),
    });
    setEvaluating(false);
    if (!result.ok) {
      setEvalError(result.message);
      return;
    }
    setEvalResult(result.data);
    applyObservation(spec.concepts, result.data.masterySignal === "correct");
  };

  const startOver = () => {
    setExperiment(null);
    setText("");
    setImageFile(null);
    setCompileError(null);
    resetLabState();
  };

  const resetMastery = () => {
    if (!window.confirm("Clear all mastery progress stored on this device?")) {
      return;
    }
    clearMasteryRecord();
    setMastery(emptyMasteryRecord());
  };

  const onPickImage = (file: File | null) => {
    if (file && file.size > MAX_IMAGE_BYTES) {
      setCompileError("Images must be 4 MB or smaller.");
      return;
    }
    setCompileError(null);
    setImageFile(file);
  };

  // ---------------------------------------------------------------- ask ---
  if (!experiment || !spec || !baseTrajectory) {
    return (
      <section className="hero">
        <h1>
          Type a physics question.
          <br />
          Get a <span className="glow">runnable experiment</span>.
        </h1>
        <p>
          The AI compiler turns your curiosity into a tiny simulation with a
          prediction to make, worlds to break, and an explanation to defend.
        </p>
        <form
          className="ask-form"
          onSubmit={(event) => {
            event.preventDefault();
            void compile(text);
          }}
        >
          <div className="ask-box">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={2000}
              placeholder="e.g. would a bowling ball and a feather really land together?"
              aria-label="What are you curious about?"
            />
            <div className="ask-actions">
              <label className="file-label">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) =>
                    onPickImage(event.target.files?.[0] ?? null)
                  }
                />
                {imageFile ? `📎 ${imageFile.name}` : "📎 attach a photo"}
              </label>
              {imageFile ? (
                <button
                  type="button"
                  className="btn subtle"
                  onClick={() => onPickImage(null)}
                >
                  remove
                </button>
              ) : null}
              <span className="spacer" />
              <button
                type="submit"
                className="btn primary"
                disabled={compiling || text.trim().length === 0}
              >
                {compiling ? (
                  <>
                    <span className="spinner" aria-hidden />
                    compiling…
                  </>
                ) : (
                  "Build my experiment"
                )}
              </button>
            </div>
          </div>
        </form>
        {compileError ? (
          <div className="ask-form">
            <div className="alert" role="alert">
              {compileError}
            </div>
          </div>
        ) : null}
        <div className="examples">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="chip"
              disabled={compiling}
              onClick={() => {
                setText(example);
                void compile(example);
              }}
            >
              {example}
            </button>
          ))}
        </div>
        <p className="footer-note">
          Works offline too — without AI credentials you get a golden bundled
          experiment. Every spec is validated server-side before it reaches
          this page.
        </p>
      </section>
    );
  }

  // ---------------------------------------------------------------- lab ---
  const prediction = spec.prediction;
  const predicted = chosenOutcomeId !== null;
  const predictedRight = chosenOutcomeId === prediction.correctOutcomeId;
  const sourceBadge =
    experiment.meta.source === "fixture"
      ? { className: "badge fixture", label: "golden fixture" }
      : { className: "badge model", label: "AI-compiled" };

  return (
    <div className="lab-grid">
      <div>
        <section className="panel">
          <div className="experiment-head">
            <div>
              <p className="kicker">Experiment · {spec.family}</p>
              <h2>{spec.title}</h2>
            </div>
            <div className="meta">
              <span className={sourceBadge.className}>{sourceBadge.label}</span>
              <button type="button" className="btn subtle" onClick={startOver}>
                new experiment
              </button>
            </div>
          </div>
          <p className="lede">{spec.description}</p>

          <p className="kicker">Step 1 · Predict</p>
          <p>{prediction.question}</p>
          <div className="outcomes">
            {prediction.outcomes.map((outcome) => {
              const isChosen = chosenOutcomeId === outcome.id;
              const isCorrect = outcome.id === prediction.correctOutcomeId;
              const revealClass = predicted
                ? isCorrect
                  ? " correct"
                  : isChosen
                    ? " wrong"
                    : ""
                : "";
              return (
                <button
                  key={outcome.id}
                  type="button"
                  className={`outcome${revealClass}`}
                  disabled={predicted}
                  aria-pressed={isChosen}
                  onClick={() => chooseOutcome(outcome.id)}
                >
                  <span>{outcome.label}</span>
                  {predicted && isCorrect ? (
                    <span className="badge ok">actual</span>
                  ) : null}
                  {predicted && isChosen && !isCorrect ? (
                    <span className="badge bad">your pick</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {predicted ? (
            <div
              className={`verdict ${predictedRight ? "ok" : "bad"}`}
              role="status"
            >
              {predictedRight
                ? "Called it. Now break the experiment below and see if your reasoning survives."
                : "Not this time — watch it run below, then test what actually drives the outcome."}
            </div>
          ) : (
            <p className="hint">
              Lock in a prediction first — the simulation stays paused so you
              can&apos;t peek.
            </p>
          )}
        </section>

        <section className="panel">
          <p className="kicker">Step 2 · Watch &amp; break it</p>
          <h2>
            {activeCf ? activeCf.label : "The world as compiled"}
          </h2>
          <p className="lede">
            {predicted
              ? "Flip one dial at a time. The amber ring is the counterfactual world running beside the original."
              : "Waiting on your prediction…"}
          </p>
          <ExperimentCanvas
            family={spec.family}
            base={baseTrajectory}
            patched={predicted ? patchedTrajectory : null}
            duration={spec.simulation.duration}
            baseLabel="original world"
            patchedLabel={activeCf?.label ?? null}
            freezeAtStart={!predicted}
          />
          {predicted ? (
            <>
              <div className="chip-row" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className={`chip${activeCfId === null ? " active" : ""}`}
                  onClick={() => setActiveCfId(null)}
                >
                  original only
                </button>
                {spec.counterfactuals.map((cf) => (
                  <button
                    key={cf.id}
                    type="button"
                    className={`chip patched${activeCfId === cf.id ? " active" : ""}`}
                    onClick={() => setActiveCfId(cf.id)}
                  >
                    {cf.label}
                  </button>
                ))}
              </div>
              {comparison ? (
                <table className="diff-table">
                  <thead>
                    <tr>
                      <th scope="col">what we measure</th>
                      <th scope="col">original</th>
                      <th scope="col" aria-hidden />
                      <th scope="col">counterfactual</th>
                      <th scope="col">change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.metrics.map((metric) => (
                      <tr key={metric.id}>
                        <td>{metric.label}</td>
                        <td className="num">
                          {formatQuantity(metric.baseValue, metric.unit)}
                        </td>
                        <td className="arrow">→</td>
                        <td className="num">
                          {formatQuantity(metric.patchedValue, metric.unit)}
                        </td>
                        <td>
                          {metric.changed ? (
                            <span className="badge moved">
                              {formatRelativeChange(metric.relativeChange)}
                            </span>
                          ) : (
                            <span className="badge neutral">no change</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="hint" style={{ marginTop: 12 }}>
                  Pick a counterfactual to see exactly which numbers move — and
                  which refuse to.
                </p>
              )}
            </>
          ) : null}
        </section>

        {predicted ? (
          <section className="panel explain-box">
            <p className="kicker">Step 3 · Explain</p>
            <h2>Defend your reasoning</h2>
            <p className="lede">{spec.explanationPrompt}</p>
            <textarea
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
              maxLength={4000}
              placeholder="Explain the mechanism in your own words — what causes what, and why?"
              aria-label="Your explanation"
            />
            <div className="ask-actions" style={{ marginTop: 10 }}>
              <span className="hint">
                Graded on correctness, mechanism, and vocabulary. Feedback
                only — you keep your own score.
              </span>
              <span className="spacer" />
              <button
                type="button"
                className="btn primary"
                disabled={evaluating || explanation.trim().length === 0}
                onClick={() => void submitExplanation()}
              >
                {evaluating ? (
                  <>
                    <span className="spinner" aria-hidden />
                    grading…
                  </>
                ) : (
                  "Get feedback"
                )}
              </button>
            </div>
            {evalError ? (
              <div className="alert" role="alert">
                {evalError}
              </div>
            ) : null}
            {evalResult ? <RubricPanel result={evalResult} /> : null}
          </section>
        ) : null}
      </div>

      <MasteryPanel record={mastery} onReset={resetMastery} />
    </div>
  );
}
