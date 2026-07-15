"use client";

import dynamic from "next/dynamic";
import {
  ArrowLeft,
  ArrowRight,
  Atom,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleGauge,
  FlaskConical,
  ImagePlus,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Target,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CompileResponse,
  EvaluationResponse,
  ExperimentSpec,
  GradeBand,
} from "@/lib/contracts/experiment";
import { experimentSpecSchema } from "@/lib/contracts/experiment";
import {
  demoForPrompt,
  dropDemo,
  pendulumDemo,
  projectileDemo,
} from "@/components/lab/demo-experiments";
import { EvidenceChart } from "@/components/lab/EvidenceChart";
import { SimulationErrorBoundary } from "@/components/lab/SimulationErrorBoundary";
import {
  applyCounterfactual,
  type SimulationEvidence,
  updateScenePath,
} from "@/lib/physics/evidence";
import {
  masteryProbability,
  recordMasteryObservation,
} from "@/lib/client/mastery-storage";

const ExperimentCanvas = dynamic(
  () => import("@/components/lab/ExperimentCanvas").then((module) => module.ExperimentCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="canvas-loading">
        <div className="loader-orbit"><span /><span /><span /></div>
        <p>Calibrating 3D world</p>
      </div>
    ),
  },
);

type Phase =
  | "input"
  | "compiling"
  | "predicting"
  | "running"
  | "evidence"
  | "explaining"
  | "counterfactual-predicting"
  | "counterfactual-running"
  | "complete";

const sleep = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));

const compileStages = [
  { label: "Reading the question", detail: "Extracting variables and learning intent" },
  { label: "Building the world", detail: "Composing safe simulation primitives" },
  { label: "Validating the physics", detail: "Checking bounds and expected outcomes" },
];

const exampleMeta = [
  { icon: CircleGauge, kicker: "FREE FALL", question: "Do heavier objects fall faster?", spec: dropDemo },
  { icon: Target, kicker: "PROJECTILES", question: "Why does a thrown ball follow an arc?", spec: projectileDemo },
  { icon: Atom, kicker: "OSCILLATION", question: "Does a heavier pendulum swing faster?", spec: pendulumDemo },
];

function phaseIndex(phase: Phase) {
  if (phase === "predicting" || phase === "running") return 0;
  if (phase === "evidence" || phase === "explaining") return 1;
  if (phase === "counterfactual-predicting" || phase === "counterfactual-running") return 2;
  if (phase === "complete") return 3;
  return 0;
}

async function prepareImage(file: File) {
  if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not prepare the image.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  if (!blob) throw new Error("This image could not be compressed.");
  if (blob.size > 2_000_000) throw new Error("The prepared image is still larger than 2 MB.");
  return new File([blob], "textbook-diagram.jpg", { type: "image/jpeg" });
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span className="brand-core" />
      <span className="brand-ring brand-ring-one" />
      <span className="brand-ring brand-ring-two" />
    </div>
  );
}

function Header({ inLab, onExit }: { inLab: boolean; onExit: () => void }) {
  return (
    <header className={`site-header ${inLab ? "lab-header" : ""}`}>
      <button className="brand-lockup" onClick={onExit} aria-label="Counterfactual Lab home">
        <BrandMark />
        <span>
          <strong>COUNTERFACTUAL</strong>
          <small>LAB</small>
        </span>
      </button>
      {!inLab ? (
        <div className="header-note">
          <span className="live-dot" />
          Built for curious minds · Grades 8–12
        </div>
      ) : (
        <button className="quiet-button" onClick={onExit}>
          <ArrowLeft size={15} /> New experiment
        </button>
      )}
    </header>
  );
}

function CompilerOverlay({ stage }: { stage: number }) {
  const currentStage = compileStages[stage] ?? compileStages[0];
  return (
    <div className="compiler-overlay" role="status" aria-live="polite">
      <div className="compiler-card">
        <div className="compiler-visual">
          <span className="compiler-sphere" />
          <span className="compiler-path compiler-path-a" />
          <span className="compiler-path compiler-path-b" />
          <Sparkles size={22} />
        </div>
        <p className="eyebrow">EXPERIMENT COMPILER</p>
        <h2>{currentStage?.label}</h2>
        <p>{currentStage?.detail}</p>
        <div className="compiler-progress">
          {compileStages.map((item, index) => (
            <div key={item.label} className={index <= stage ? "active" : ""}>
              <span>{index < stage ? <Check size={12} /> : index + 1}</span>
              <small>{item.label}</small>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Landing({
  prompt,
  setPrompt,
  gradeBand,
  setGradeBand,
  image,
  imagePreview,
  setImage,
  setImagePreview,
  error,
  setError,
  compile,
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  gradeBand: GradeBand;
  setGradeBand: (value: GradeBand) => void;
  image: File | null;
  imagePreview: string | null;
  setImage: (value: File | null) => void;
  setImagePreview: (value: string | null) => void;
  error: string | null;
  setError: (value: string | null) => void;
  compile: (spec?: ExperimentSpec) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const prepared = await prepareImage(file);
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImage(prepared);
      setImagePreview(URL.createObjectURL(prepared));
      setError(null);
    } catch (uploadError) {
      setImage(null);
      setImagePreview(null);
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "This image could not be prepared.",
      );
    }
  };

  return (
    <main className="landing">
      <div className="hero-orbit hero-orbit-a" />
      <div className="hero-orbit hero-orbit-b" />
      <section className="hero-section">
        <div className="hero-copy">
          <div className="hero-badge"><Zap size={13} /> AI-GENERATED INTERACTIVE PHYSICS</div>
          <h1>
            Don’t just learn
            <span>the answer.</span>
            <em>Change the world.</em>
          </h1>
          <p className="hero-lede">
            Turn any mechanics question or textbook diagram into a living 3D experiment. Predict it. Run it. Prove it.
          </p>
          <div className="impact-row">
            <div><strong>03</strong><span>physics engines</span></div>
            <div><strong>∞</strong><span>counterfactuals</span></div>
            <div><strong>0</strong><span>answers handed to you</span></div>
          </div>
        </div>

        <div className="prompt-console">
          <div className="console-header">
            <span><FlaskConical size={16} /> CREATE AN EXPERIMENT</span>
            <div className="grade-switch" aria-label="Grade level">
              <button className={gradeBand === "8-10" ? "active" : ""} onClick={() => setGradeBand("8-10")}>8–10</button>
              <button className={gradeBand === "11-12" ? "active" : ""} onClick={() => setGradeBand("11-12")}>11–12</button>
            </div>
          </div>
          <label htmlFor="experiment-question">What do you want to understand?</label>
          <textarea
            id="experiment-question"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Why don’t heavier objects fall faster?"
            rows={3}
          />
          {imagePreview && (
            <div className="image-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview} alt="Uploaded textbook diagram preview" />
              <div><ImagePlus size={15} /><span>Diagram ready</span><small>Compressed and stripped of metadata</small></div>
              <button aria-label="Remove image" onClick={() => { URL.revokeObjectURL(imagePreview); setImage(null); setImagePreview(null); }}><X size={16} /></button>
            </div>
          )}
          <div className="console-actions">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => onFile(event.target.files?.[0])} />
            <button className="upload-button" onClick={() => fileRef.current?.click()}>
              <Upload size={16} /> {image ? "Replace diagram" : "Add diagram"}
            </button>
            <button className="compile-button" disabled={!prompt.trim() && !image} onClick={() => compile()}>
              Build my world <ArrowRight size={17} />
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
          <p className="privacy-note"><span /> Images are analyzed in memory and never saved.</p>
        </div>
      </section>

      <section className="example-section">
        <div className="section-heading">
          <div><p className="eyebrow">START WITH A PROVEN PARADOX</p><h2>Three worlds. One way of thinking.</h2></div>
          <p>Every lab begins with a prediction—because seeing an answer is not the same as changing your mind.</p>
        </div>
        <div className="example-grid">
          {exampleMeta.map(({ icon: Icon, kicker, question, spec }, index) => (
            <button key={spec.id} className="example-card" onClick={() => { setPrompt(question); compile(spec); }}>
              <div className="example-index">0{index + 1}</div>
              <Icon size={22} />
              <span>{kicker}</span>
              <h3>{question}</h3>
              <div className="example-link">Enter experiment <ChevronRight size={15} /></div>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

function ProgressRail({ phase }: { phase: Phase }) {
  const active = phaseIndex(phase);
  const steps = ["Predict", "Observe", "Challenge", "Master"];
  return (
    <div className="progress-rail">
      {steps.map((step, index) => (
        <div key={step} className={`${index === active ? "current" : ""} ${index < active ? "done" : ""}`}>
          <span>{index < active ? <Check size={11} /> : index + 1}</span>
          <small>{step}</small>
        </div>
      ))}
    </div>
  );
}

function PredictionPanel({
  spec,
  selected,
  setSelected,
  onRun,
  counterfactual,
  running,
}: {
  spec: ExperimentSpec;
  selected: string | null;
  setSelected: (value: string) => void;
  onRun: () => void;
  counterfactual: boolean;
  running: boolean;
}) {
  const testChange = spec.prediction.testChange;
  const changedVariable = testChange?.targetPath
    .split(".")
    .at(-1)
    ?.replace(/([a-z])([A-Z])/g, "$1 $2");

  return (
    <div className="panel-content prediction-panel">
      <p className="panel-kicker">{counterfactual ? "COUNTERFACTUAL 01" : "COMMIT BEFORE YOU SEE"}</p>
      <h2>{spec.prediction.prompt}</h2>
      <p className="panel-support">Your prediction is locked before the experiment runs. That friction is where learning begins.</p>
      {testChange && changedVariable && (
        <div className="test-change" aria-label={`Only ${changedVariable} changes to ${testChange.value}`}>
          <small>ONE VARIABLE CHANGES</small>
          <strong>{changedVariable}</strong>
          <ArrowRight size={13} />
          <span>{testChange.value}</span>
        </div>
      )}
      <div className="choice-list">
        {spec.prediction.choices.map((choice, index) => (
          <button
            key={choice.id}
            className={selected === choice.id ? "selected" : ""}
            disabled={running}
            onClick={() => setSelected(choice.id)}
          >
            <span>{String.fromCharCode(65 + index)}</span>
            {choice.label}
            {selected === choice.id && <Check size={15} />}
          </button>
        ))}
      </div>
      <button className="run-button" disabled={!selected || running} onClick={onRun}>
        <Play size={17} fill="currentColor" /> {running ? "Experiment running" : "Run experiment"}
      </button>
    </div>
  );
}

function EvidencePanel({
  spec,
  evidence,
  explanation,
  setExplanation,
  onEvaluate,
}: {
  spec: ExperimentSpec;
  evidence: SimulationEvidence;
  explanation: string;
  setExplanation: (value: string) => void;
  onEvaluate: () => void;
}) {
  return (
    <div className="panel-content evidence-panel">
      <div className="evidence-status"><span><Check size={13} /></span> EXPERIMENT COMPLETE</div>
      <h2>What the world showed</h2>
      <div className="metric-grid">
        <div><small>{evidence.metricA.label}</small><strong>{evidence.metricA.value}</strong></div>
        <div><small>{evidence.metricB.label}</small><strong>{evidence.metricB.value}</strong></div>
      </div>
      <EvidenceChart spec={spec} evidence={evidence} />
      <p className="evidence-summary">{evidence.summary}</p>
      <label htmlFor="explanation">Now explain the result in your own words.</label>
      <textarea id="explanation" value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder={spec.prediction.reasoningPrompt} rows={3} />
      <button className="primary-panel-button" disabled={explanation.trim().length < 12} onClick={onEvaluate}>
        Test my explanation <ArrowRight size={16} />
      </button>
    </div>
  );
}

function FeedbackPanel({ spec, evaluation, onChallenge }: { spec: ExperimentSpec; evaluation: EvaluationResponse; onChallenge: () => void }) {
  return (
    <div className="panel-content feedback-panel">
      <p className="panel-kicker">YOUR MODEL, UPDATED</p>
      <div className="score-ring" style={{ "--score": `${Math.round(evaluation.score * 100) * 3.6}deg` } as React.CSSProperties}>
        <div><strong>{Math.round(evaluation.score * 100)}</strong><small>reasoning score</small></div>
      </div>
      <h2>{spec.misconception.title}</h2>
      <p>{evaluation.feedback}</p>
      <div className="rubric-list">
        {spec.misconception.explanationRubric.map((item, index) => {
          const passed = Object.values(evaluation.criteria)[index] ?? evaluation.score > index * 0.25;
          return <div key={item} className={passed ? "passed" : ""}><span>{passed ? <Check size={12} /> : index + 1}</span>{item}</div>;
        })}
      </div>
      <div className="hint-box"><BrainCircuit size={18} /><div><small>NEXT LENS</small><p>{evaluation.hint}</p></div></div>
      <button className="primary-panel-button" onClick={onChallenge}>
        Challenge this model <Zap size={16} />
      </button>
    </div>
  );
}

function CompletePanel({ spec, firstCorrect, transferCorrect, mastery, onRestart }: { spec: ExperimentSpec; firstCorrect: boolean; transferCorrect: boolean; mastery: number; onRestart: () => void }) {
  return (
    <div className="panel-content complete-panel">
      <div className="completion-spark"><Sparkles size={24} /></div>
      <p className="panel-kicker">MENTAL MODEL REVISED</p>
      <h2>You didn’t memorize it.<br />You tested it.</h2>
      <div className="mastery-card">
        <div><small>{spec.misconception.title}</small><strong>{mastery}%</strong></div>
        <div className="mastery-track"><span style={{ width: `${mastery}%` }} /></div>
        <div className="mastery-events">
          <span className={firstCorrect ? "correct" : "revised"}>{firstCorrect ? <Check size={12} /> : <RotateCcw size={12} />} First prediction</span>
          <span className={transferCorrect ? "correct" : "revised"}>{transferCorrect ? <Check size={12} /> : <RotateCcw size={12} />} Transfer test</span>
        </div>
      </div>
      <blockquote>“What changed in your model of the world?”</blockquote>
      <p className="complete-copy">The next time you meet this idea, you have evidence—not just an answer.</p>
      <button className="primary-panel-button" onClick={onRestart}>Build another world <ArrowRight size={16} /></button>
    </div>
  );
}

function LabWorkspace({
  spec,
  setSpec,
  phase,
  setPhase,
  onExit,
  compilerNotice,
}: {
  spec: ExperimentSpec;
  setSpec: (spec: ExperimentSpec) => void;
  phase: Phase;
  setPhase: (phase: Phase) => void;
  onExit: () => void;
  compilerNotice: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);
  const [runToken, setRunToken] = useState(0);
  const [evidence, setEvidence] = useState<SimulationEvidence | null>(null);
  const [explanation, setExplanation] = useState("");
  const [evaluation, setEvaluation] = useState<EvaluationResponse | null>(null);
  const [firstCorrect, setFirstCorrect] = useState(false);
  const [transferCorrect, setTransferCorrect] = useState(false);
  const [mastery, setMastery] = useState(25);

  useEffect(() => {
    setMastery(
      Math.round(masteryProbability(spec.misconception.id) * 100),
    );
  }, [spec.misconception.id]);

  const capturing = phase === "running" || phase === "counterfactual-running";
  const counterfactual = phase === "counterfactual-predicting" || phase === "counterfactual-running";
  const chosen = spec.prediction.choices.find((choice) => choice.id === selected);

  const run = () => {
    if (!selected || capturing) return;
    const testChange = spec.prediction.testChange;
    if (testChange) {
      const updated = updateScenePath(
        spec,
        testChange.targetPath,
        testChange.value,
      );
      setSpec({
        ...updated,
        controls: updated.controls.map((control) =>
          control.targetPath === testChange.targetPath
            ? { ...control, value: testChange.value }
            : control,
        ),
      });
    }
    setEvidence(null);
    setLaunched(true);
    setPhase(counterfactual ? "counterfactual-running" : "running");
  };

  const onComplete = useCallback(
    (result: SimulationEvidence) => {
      setEvidence(result);
      const correct = chosen?.outcomeKey === result.outcomeKey;
      if (phase === "running") {
        setFirstCorrect(correct);
        setMastery(
          Math.round(
            recordMasteryObservation(spec.misconception.id, correct) * 100,
          ),
        );
        setPhase("evidence");
      } else if (phase === "counterfactual-running") {
        setTransferCorrect(correct);
        setMastery(
          Math.round(
            recordMasteryObservation(spec.misconception.id, correct) * 100,
          ),
        );
        setPhase("complete");
      }
    },
    [chosen?.outcomeKey, phase, setPhase, spec.misconception.id],
  );

  const evaluate = async () => {
    const fallback: EvaluationResponse = {
      score: Math.min(0.94, 0.58 + Math.min(explanation.trim().split(/\s+/).length, 24) / 70),
      criteria: { evidence: true, causality: /acceler|gravity|velocity|period|mass|length/i.test(explanation), transfer: explanation.length > 45 },
      feedback: `You connected the observed evidence to the underlying mechanism. The key refinement is that ${spec.misconception.description.toLowerCase()}`,
      hint: spec.scene.family === "drop" ? "Change shape while holding mass constant." : spec.scene.family === "projectile" ? "Change one velocity component at a time." : "Change length while holding mass constant.",
    };
    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ experimentId: spec.id, observedOutcome: evidence?.outcomeKey, studentExplanation: explanation, misconception: spec.misconception }),
      });
      const data = response.ok ? ((await response.json()) as EvaluationResponse) : fallback;
      setEvaluation(data);
    } catch {
      setEvaluation(fallback);
    }
    setPhase("explaining");
  };

  const beginCounterfactual = () => {
    const next = spec.counterfactuals[0];
    if (!next) {
      setPhase("complete");
      return;
    }
    setSpec(applyCounterfactual(spec, next));
    setSelected(null);
    setExplanation("");
    setEvidence(null);
    setLaunched(false);
    setRunToken((value) => value + 1);
    setPhase("counterfactual-predicting");
  };

  const changeControl = (id: string, value: number) => {
    const control = spec.controls.find((item) => item.id === id);
    if (!control) return;
    const updated = updateScenePath(spec, control.targetPath, value);
    setSpec({ ...updated, controls: updated.controls.map((item) => (item.id === id ? { ...item, value } : item)) });
    setRunToken((token) => token + 1);
  };

  return (
    <main className="lab-workspace">
      <div className="lab-topline">
        <div className="lab-title-block">
          <span className="family-chip">{spec.scene.family}</span>
          <div>
            <h1>{spec.title}</h1>
            <p>{spec.objective}</p>
            {compilerNotice && (
              <small className="compiler-notice">{compilerNotice}</small>
            )}
          </div>
        </div>
        <ProgressRail phase={phase} />
        <div className="mastery-pill"><BrainCircuit size={15} /><span>Mastery</span><strong>{mastery}%</strong></div>
      </div>

      <div className="lab-grid">
        <section className="simulation-stage">
          <div className="stage-toolbar">
            <div><span className="status-light" /> {capturing ? "SIMULATION RUNNING" : launched ? "EVIDENCE CAPTURED" : "WORLD READY"}</div>
            <div className="stage-tools">
              <span>drag to orbit</span>
              <button aria-label="Reset view and simulation" onClick={() => { setLaunched(false); setRunToken((value) => value + 1); setPhase(counterfactual ? "counterfactual-predicting" : "predicting"); }}><RotateCcw size={14} /></button>
            </div>
          </div>
          <div className="canvas-shell">
            <SimulationErrorBoundary resetKey={`${spec.id}-${runToken}`}>
              <ExperimentCanvas
                spec={spec}
                runToken={runToken}
                launched={launched}
                capturing={capturing}
                onComplete={onComplete}
              />
            </SimulationErrorBoundary>
            <div className="canvas-vignette-copy">
              <small>SOURCE MODEL</small>
              <p>{spec.sourceSummary}</p>
            </div>
            {capturing && <div className="capture-badge"><span /><Pause size={12} /> collecting evidence</div>}
          </div>
          <div className="control-deck">
            <div className="control-heading"><span><CircleGauge size={15} /> VARIABLES</span><small>{launched ? "locked during observation" : "change one thing at a time"}</small></div>
            <div className="controls-grid">
              {spec.controls.map((control) => (
                <label key={control.id}>
                  <span>{control.label}<strong>{control.value.toFixed(control.step < 1 ? 1 : 0)} {control.unit}</strong></span>
                  <input type="range" min={control.min} max={control.max} step={control.step} value={control.value} disabled={launched || phase !== "predicting"} onChange={(event) => changeControl(control.id, Number(event.target.value))} />
                </label>
              ))}
            </div>
          </div>
        </section>

        <aside className="learning-panel">
          {(phase === "predicting" || phase === "counterfactual-predicting" || phase === "running" || phase === "counterfactual-running") && (
            <PredictionPanel
              spec={spec}
              selected={selected}
              setSelected={setSelected}
              onRun={run}
              counterfactual={counterfactual}
              running={capturing}
            />
          )}
          {phase === "evidence" && evidence && <EvidencePanel spec={spec} evidence={evidence} explanation={explanation} setExplanation={setExplanation} onEvaluate={evaluate} />}
          {phase === "explaining" && evaluation && <FeedbackPanel spec={spec} evaluation={evaluation} onChallenge={beginCounterfactual} />}
          {phase === "complete" && <CompletePanel spec={spec} firstCorrect={firstCorrect} transferCorrect={transferCorrect} mastery={mastery} onRestart={onExit} />}
          {capturing && (
            <div className="running-overlay">
              <div className="pulse-radar"><span /><span /><span /></div>
              <p>Reality is answering</p>
              <small>Measuring at 10 samples / second</small>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

export function CounterfactualLab() {
  const [phase, setPhase] = useState<Phase>("input");
  const [prompt, setPrompt] = useState("");
  const [gradeBand, setGradeBand] = useState<GradeBand>("8-10");
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [compilerNotice, setCompilerNotice] = useState<string | null>(null);
  const [spec, setSpec] = useState<ExperimentSpec>(dropDemo);

  const reset = () => {
    setPhase("input");
    setError(null);
    setCompilerNotice(null);
    setImage(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
  };

  const compile = async (directSpec?: ExperimentSpec) => {
    setError(null);
    setCompilerNotice(null);
    setPhase("compiling");
    setStage(0);
    let generated: ExperimentSpec | null = directSpec ?? null;
    let compileFailure: string | null = null;
    let nextCompilerNotice: string | null = null;
    const compileRequest = async () => {
      if (directSpec) return;
      const form = new FormData();
      form.set("prompt", prompt.trim() || "Explain the mechanics in this diagram.");
      form.set("gradeBand", gradeBand);
      if (image) form.set("image", image);
      try {
        const response = await fetch("/api/compile", { method: "POST", body: form });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          compileFailure =
            payload?.error?.message ??
            "This question could not be compiled into a supported experiment.";
          return;
        }
        const payload = (await response.json()) as CompileResponse;
        const parsed = experimentSpecSchema.safeParse(payload.spec);
        if (!parsed.success) {
          compileFailure =
            "The generated experiment failed its final safety check. Try one of the three mechanics examples.";
          return;
        }
        generated = parsed.data;
        if (payload.warnings.length > 0) {
          nextCompilerNotice = payload.warnings.join(" ");
        } else if (payload.provenance.source === "generated") {
          nextCompilerNotice = `AI-generated${payload.provenance.model ? ` with ${payload.provenance.model}` : ""} · physics validated`;
        } else {
          nextCompilerNotice = "Using a bundled, physics-validated example.";
        }
      } catch {
        nextCompilerNotice =
          "Compiler offline · using a bundled, physics-validated example.";
      }
    };
    const request = compileRequest();
    await sleep(540);
    setStage(1);
    await sleep(620);
    setStage(2);
    await Promise.all([request, sleep(620)]);
    if (compileFailure) {
      setError(compileFailure);
      setPhase("input");
      return;
    }
    const fallback = directSpec ?? demoForPrompt(prompt || image?.name || "drop");
    if (!directSpec && !generated && !nextCompilerNotice) {
      nextCompilerNotice = "Using a bundled, physics-validated example.";
    }
    setCompilerNotice(nextCompilerNotice);
    setSpec(structuredClone(generated ?? fallback));
    setPhase("predicting");
  };

  const inLab = phase !== "input" && phase !== "compiling";
  return (
    <div className="app-shell">
      <Header inLab={inLab} onExit={reset} />
      {phase === "input" && (
        <Landing
          prompt={prompt}
          setPrompt={setPrompt}
          gradeBand={gradeBand}
          setGradeBand={setGradeBand}
          image={image}
          imagePreview={imagePreview}
          setImage={setImage}
          setImagePreview={setImagePreview}
          error={error}
          setError={setError}
          compile={compile}
        />
      )}
      {phase === "compiling" && <><Landing prompt={prompt} setPrompt={setPrompt} gradeBand={gradeBand} setGradeBand={setGradeBand} image={image} imagePreview={imagePreview} setImage={setImage} setImagePreview={setImagePreview} error={error} setError={setError} compile={compile} /><CompilerOverlay stage={stage} /></>}
      {inLab && (
        <LabWorkspace
          key={spec.id}
          spec={spec}
          setSpec={setSpec}
          phase={phase}
          setPhase={setPhase}
          onExit={reset}
          compilerNotice={compilerNotice}
        />
      )}
    </div>
  );
}
