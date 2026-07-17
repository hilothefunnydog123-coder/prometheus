"use client";

import dynamic from "next/dynamic";
import {
  ArrowLeft,
  ArrowRight,
  Atom,
  BadgeCheck,
  Check,
  ChevronRight,
  CircleGauge,
  Crosshair,
  Expand,
  FlaskConical,
  ImagePlus,
  Lightbulb,
  LockKeyhole,
  Minimize2,
  Minus,
  Orbit,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  Upload,
  Wind,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  CompileResponse,
  EvaluationResponse,
  ExperimentSpec,
  GradeBand,
} from "@/lib/contracts/experiment";
import { experimentSpecSchema } from "@/lib/contracts/experiment";
import {
  dropDemo,
  demoForPrompt,
  pendulumDemo,
  projectileDemo,
} from "@/components/lab/demo-experiments";
import { EvidenceChart } from "@/components/lab/EvidenceChart";
import { SimulationErrorBoundary } from "@/components/lab/SimulationErrorBoundary";
import type { CameraCommand } from "@/components/lab/ExperimentCanvas";
import {
  applyCounterfactual,
  isVelocityFocusedDrop,
  PROJECTILE_AIR_DENSITY_KG_PER_CUBIC_METER,
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
        <Atom className="loading-atom" size={34} aria-hidden="true" />
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
const MAX_QUESTION_LENGTH = 500;

const compileStages = [
  { label: "Reading the question", detail: "Extracting variables and learning intent" },
  { label: "Building the world", detail: "Composing safe simulation primitives" },
  { label: "Validating the physics", detail: "Checking bounds and expected outcomes" },
];

const exampleMeta = [
  { id: "drop", icon: CircleGauge, kicker: "FREE FALL", question: "Do heavier objects fall faster?", spec: dropDemo },
  { id: "projectile", icon: Target, kicker: "PROJECTILES", question: "Why does a thrown ball follow an arc?", spec: projectileDemo },
  { id: "pendulum", icon: Atom, kicker: "OSCILLATION", question: "Does a heavier pendulum swing faster?", spec: pendulumDemo },
];

type ValidatedExampleOffer = {
  spec: ExperimentSpec;
  warning: string;
};

function canonicalQuestionFor(spec: ExperimentSpec) {
  return (
    exampleMeta.find((example) => example.id === spec.scene.family)?.question ??
    spec.objective
  );
}

function compactCompilerNotice(notice: string) {
  const normalized = notice.toLowerCase();
  if (normalized.includes("pre-coded")) {
    return "Pre-coded preset · not generated for this question";
  }
  if (normalized.includes("ai-generated")) {
    return "AI-generated model · physics validated";
  }
  return "Validated simulation model · provenance checked";
}

function sceneLegend(spec: ExperimentSpec) {
  return spec.measurements.slice(0, 3).map((measurement) => ({
    id: measurement.id,
    color: measurement.color,
    label: `${measurement.label}${measurement.unit ? ` · ${measurement.unit}` : ""}`,
  }));
}

function phaseIndex(phase: Phase) {
  if (phase === "input" || phase === "compiling") return 0;
  if (phase === "predicting") return 1;
  if (phase === "running") return 2;
  if (phase === "evidence") return 3;
  if (phase === "explaining") return 4;
  if (
    phase === "counterfactual-predicting" ||
    phase === "counterfactual-running"
  ) return 5;
  if (phase === "complete") return 5;
  return 0;
}

type ExperimentChange = {
  targetPath: string;
  label: string;
  before: number | null;
  after: number;
  unit: string;
};

function variableMetadata(
  spec: ExperimentSpec,
  targetPath: string,
): { label: string; value: number | null; unit: string } {
  const control = spec.controls.find((item) => item.targetPath === targetPath);
  if (control) {
    return { label: control.label, value: control.value, unit: control.unit };
  }
  return {
    label:
      targetPath
        .split(".")
        .at(-1)
        ?.replace(/([a-z])([A-Z])/g, "$1 $2") ?? "Test variable",
    value: null,
    unit: "",
  };
}

function describeExperimentChange(
  spec: ExperimentSpec,
  targetPath: string,
  after: number,
): ExperimentChange {
  const metadata = variableMetadata(spec, targetPath);
  return { targetPath, ...metadata, before: metadata.value, after };
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
    <span className="brand-mark" aria-hidden="true">
      <Orbit size={25} strokeWidth={1.65} />
    </span>
  );
}

function Header({ inLab, phase, onExit }: { inLab: boolean; phase: Phase; onExit: () => void }) {
  return (
    <header className={`site-header ${inLab ? "lab-header" : ""}`}>
      <button className="brand-lockup" onClick={onExit} aria-label="Counterfactual Lab home">
        <BrandMark />
        <span>
          <strong>COUNTERFACTUAL</strong>
          <small>LAB</small>
        </span>
      </button>
      {inLab && (
        <nav className="header-progress" aria-label="Experiment progress">
          <ProgressRail phase={phase} />
        </nav>
      )}
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

function ExitConfirmation({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => cancelButton.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      window.requestAnimationFrame(() => previousFocus?.focus());
    };
  }, [onCancel, open]);

  if (!open) return null;
  return (
    <div
      className="exit-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialog}
        className="exit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-dialog-title"
        aria-describedby="exit-dialog-description"
      >
        <div className="exit-dialog-icon"><FlaskConical size={22} aria-hidden="true" /></div>
        <p className="panel-kicker">EXPERIMENT IN PROGRESS</p>
        <h2 id="exit-dialog-title">Leave this experiment?</h2>
        <p id="exit-dialog-description">
          Your current prediction, evidence, and transfer progress will be cleared.
        </p>
        <div>
          <button ref={cancelButton} type="button" className="dialog-cancel" onClick={onCancel}>
            Keep experimenting
          </button>
          <button type="button" className="dialog-confirm" onClick={onConfirm}>
            Leave experiment
          </button>
        </div>
      </div>
    </div>
  );
}

function CompilerOverlay({ stage }: { stage: number }) {
  const currentStage = compileStages[stage] ?? compileStages[0];
  return (
    <div className="compiler-overlay" role="status" aria-live="polite">
      <div className="compiler-card">
        <div className="compiler-visual">
          <Atom size={54} strokeWidth={1.15} aria-hidden="true" />
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

/** Scroll-reveal wrapper: fades and lifts its section into view once. */
function Reveal({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("in-view");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <section ref={ref} className={`reveal ${className}`.trim()}>
      {children}
    </section>
  );
}

/** Count-up number that animates once when scrolled into view. */
function CountUp({
  to,
  pad = 2,
  duration = 1100,
}: {
  to: number;
  pad?: number;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const started = useRef(false);
  const [value, setValue] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined") {
      setValue(to);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !started.current) {
            started.current = true;
            const start = performance.now();
            const tick = (now: number) => {
              const progress = Math.min(1, (now - start) / duration);
              const eased = 1 - Math.pow(1 - progress, 3);
              setValue(Math.round(eased * to));
              if (progress < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.55 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [to, duration]);
  return <span ref={ref}>{String(value).padStart(pad, "0")}</span>;
}

const tickerEntries = [
  ["GRAVITY", "g = 9.81 m/s²"],
  ["PENDULUM", "T = 2π√(L/g)"],
  ["DRAG", "F_d = ½ρC_dAv²"],
  ["ENERGY", "E = ½mv² + mgh"],
  ["NEWTON II", "a = F/m"],
  ["KINEMATICS", "x = x₀ + v₀t + ½at²"],
  ["ORBITS", "F = Gm₁m₂/r²"],
  ["SPRINGS", "F = −kx"],
  ["MOMENTUM", "p = mv"],
  ["IMPULSE", "J = FΔt = Δp"],
  ["CIRCULAR", "a_c = v²/r"],
  ["WORK", "W = Fd cosθ"],
] as const;

const mechanismSteps = [
  {
    icon: LockKeyhole,
    kicker: "STEP 01",
    title: "Commit a prediction",
    body: "Lock in what you think happens before anything moves. That friction is where a wrong intuition finally gets exposed.",
  },
  {
    icon: Play,
    kicker: "STEP 02",
    title: "Run the real world",
    body: "A deterministic 3D physics engine plays it out. Motion, measurements, and evidence charts stay perfectly in sync.",
  },
  {
    icon: Lightbulb,
    kicker: "STEP 03",
    title: "Explain, then transfer",
    body: "Say why it happened, get rubric feedback, then change one variable and predict again in a world that shifted.",
  },
];

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
  validatedExampleOffer,
  openValidatedExample,
  openExample,
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
  validatedExampleOffer: ValidatedExampleOffer | null;
  openValidatedExample: () => void;
  openExample: (spec: ExperimentSpec) => void;
  compile: (promptOverride?: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const starterQuestions = [
    "How does air resistance change a falling object's motion?",
    "What makes a pendulum's period longer?",
    "How does launch angle change a projectile's range?",
  ];

  const clearImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImage(null);
    setImagePreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const focusExperimentConsole = () => {
    const question = document.getElementById("experiment-question");
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    question?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });
    window.requestAnimationFrame(() => question?.focus({ preventScroll: true }));
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const prepared = await prepareImage(file);
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImage(prepared);
      setImagePreview(URL.createObjectURL(prepared));
      setError(null);
    } catch (uploadError) {
      clearImage();
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "This image could not be prepared.",
      );
    }
  };

  return (
    <main id="main-content" className="landing" tabIndex={-1}>
      <Reveal className="hero-shell">
      <div className="hero-panel">
      <div className="hero-aurora" aria-hidden="true" />
      <div className="hero-grid" aria-hidden="true" />
      <div className="hero-orbit hero-orbit-a" />
      <div className="hero-orbit hero-orbit-b" />
      <div className="hero-spark" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <div className="hero-scan" aria-hidden="true" />
      <div className="hero-section">
        <div className="hero-copy">
          <div className="hero-chip">
            <span className="hero-chip-dot" aria-hidden="true" />
            <span className="micro">LIVE PHYSICS ENGINE</span>
            <span className="hero-chip-line">Deterministic. Every outcome is proven, never guessed.</span>
          </div>
          <div className="hero-badge"><Zap size={13} /> AI-GENERATED INTERACTIVE PHYSICS</div>
          <h1>
            Don’t just learn
            <span>the answer.</span>
            <em>Change the world.</em>
          </h1>
          <p className="hero-lede">
            Turn any mechanics question or textbook diagram into a living 3D experiment. Predict it. Run it. Prove it.
          </p>
          <button
            type="button"
            className="hero-mobile-cta"
            onClick={focusExperimentConsole}
          >
            Create an experiment <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="prompt-console">
          <div className="console-header">
            <span><FlaskConical size={16} /> CREATE AN EXPERIMENT</span>
            <div className="grade-switch" aria-label="Grade level">
              <button aria-pressed={gradeBand === "8-10"} className={gradeBand === "8-10" ? "active" : ""} onClick={() => setGradeBand("8-10")}>8–10</button>
              <button aria-pressed={gradeBand === "11-12"} className={gradeBand === "11-12" ? "active" : ""} onClick={() => setGradeBand("11-12")}>11–12</button>
            </div>
          </div>
          <label htmlFor="experiment-question">What do you want to understand?</label>
          <p id="experiment-scope" className="prompt-scope">
            Ask anything in mechanics — falling objects, projectiles, pendulums,
            springs, collisions, orbits. The AI builds each world live.
          </p>
          <textarea
            id="experiment-question"
            aria-describedby="experiment-scope experiment-question-limit"
            value={prompt}
            onChange={(event) =>
              setPrompt(event.target.value.slice(0, MAX_QUESTION_LENGTH))
            }
            placeholder="Why don’t heavier objects fall faster?"
            rows={3}
            maxLength={MAX_QUESTION_LENGTH}
          />
          <div className="starter-questions" aria-label="Starter mechanics questions">
            <span>TRY A QUESTION</span>
            <div>
              {starterQuestions.map((question) => (
                <button
                  type="button"
                  key={question}
                  onClick={() => {
                    setPrompt(question);
                    setError(null);
                    document.getElementById("experiment-question")?.focus();
                  }}
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
          <p id="experiment-question-limit" className="question-limit">
            <span>Questions can be up to {MAX_QUESTION_LENGTH} characters.</span>
            <output aria-label={`${prompt.length} of ${MAX_QUESTION_LENGTH} characters used`}>
              {prompt.length}/{MAX_QUESTION_LENGTH}
            </output>
          </p>
          {imagePreview && (
            <div className="image-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview} alt="Uploaded textbook diagram preview" />
              <div><ImagePlus size={15} /><span>Diagram ready</span><small>Compressed and stripped of metadata</small></div>
              <button aria-label="Remove image" onClick={clearImage}><X size={16} /></button>
            </div>
          )}
          <div className="console-actions">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => onFile(event.target.files?.[0])} />
            <button className="upload-button" onClick={() => {
              if (!fileRef.current) return;
              fileRef.current.value = "";
              fileRef.current.click();
            }}>
              <Upload size={16} /> {image ? "Replace diagram" : "Add diagram"}
            </button>
            <button className="compile-button" disabled={!prompt.trim() && !image} onClick={() => compile()}>
              Build my world <ArrowRight size={17} />
            </button>
          </div>
          {error && (
            <div className="form-error-stack">
              <p className="form-error" role="alert">{error}</p>
              {validatedExampleOffer && (
                <div className="validated-example-offer">
                  <div>
                    <strong>Reliable demo available</strong>
                    <span>{validatedExampleOffer.warning}</span>
                  </div>
                  <button type="button" onClick={openValidatedExample}>
                    Open the validated {validatedExampleOffer.spec.scene.family} demo
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>
          )}
          <p className="privacy-note"><span /> Images are analyzed in memory and never saved.</p>
        </div>
      </div>
      </div>
      <div className="physics-ticker" aria-hidden="true">
        <div className="physics-ticker-track">
          {[0, 1].map((pass) =>
            tickerEntries.map(([name, formula]) => (
              <span key={`${pass}-${name}`}>
                <b>{name}</b> {formula}
              </span>
            )),
          )}
        </div>
      </div>
      </Reveal>

      <Reveal className="proof-strip">
        <p className="micro proof-kicker">GRADED BY DETERMINISTIC PHYSICS · EVERY SINGLE RUN</p>
        <div className="proof-stats">
          <div className="proof-stat">
            <strong><CountUp to={3} /></strong>
            <span>physics engines</span>
          </div>
          <div className="proof-stat">
            <strong><CountUp to={9} /></strong>
            <span>proven outcomes</span>
          </div>
          <div className="proof-stat">
            <strong>&infin;</strong>
            <span>counterfactuals</span>
          </div>
          <div className="proof-stat">
            <strong>0</strong>
            <span>answers handed to you</span>
          </div>
        </div>
      </Reveal>

      <Reveal className="example-section">
        <div className="section-heading">
          <div><p className="eyebrow">02 · START WITH A PROVEN PARADOX</p><h2>Three worlds. One way of thinking.</h2></div>
          <p>Every lab begins with a prediction, because seeing an answer is not the same as changing your mind.</p>
        </div>
        <div className="example-grid">
          {exampleMeta.map(({ id, icon: Icon, kicker, question, spec }, index) => (
            <button key={id} className="example-card" onClick={() => openExample(spec)}>
              <div className="example-index">0{index + 1}</div>
              <Icon size={22} />
              <span>{kicker}</span>
              <h3>{question}</h3>
              <div className="example-link">Enter experiment <ChevronRight size={15} /></div>
            </button>
          ))}
        </div>
      </Reveal>

      <Reveal className="mechanism-section">
        <div className="section-heading">
          <div><p className="eyebrow">03 · THE MECHANISM</p><h2>Predict. Run. Prove.</h2></div>
          <p>No answer is ever handed to you. You earn it by testing the world, then breaking it on purpose.</p>
        </div>
        <div className="mechanism-grid">
          {mechanismSteps.map(({ icon: Icon, kicker, title, body }) => (
            <div key={kicker} className="mechanism-card">
              <div className="mechanism-icon"><Icon size={19} strokeWidth={1.7} /></div>
              <p className="micro">{kicker}</p>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal className="closing-shell">
        <div className="closing-panel">
          <div className="hero-grid" aria-hidden="true" />
          <p className="eyebrow">04 · YOUR TURN</p>
          <h2>Ask a question. Change the world. <em>Prove it.</em></h2>
          <p className="closing-lede">
            One question becomes a world you can rerun. The physics is deterministic, so what you learn is real.
          </p>
          <button
            className="closing-cta"
            onClick={() => {
              const field = document.getElementById("experiment-question");
              window.scrollTo({ top: 0, behavior: "smooth" });
              if (field instanceof HTMLTextAreaElement) {
                window.setTimeout(() => field.focus(), 360);
              }
            }}
          >
            Build my first world <ArrowRight size={17} />
          </button>
        </div>
      </Reveal>
    </main>
  );
}

function ProgressRail({ phase }: { phase: Phase }) {
  const active = phaseIndex(phase);
  const steps = ["Ask", "Predict", "Test", "Evidence", "Explain", "Transfer"];
  const journeyComplete = phase === "complete";
  return (
    <div className="progress-rail" role="list">
      {steps.map((step, index) => {
        const done = index < active || (journeyComplete && index === active);
        const current = index === active && !journeyComplete;
        return (
          <div
            key={step}
            role="listitem"
            aria-label={`Step ${index + 1} of ${steps.length}: ${step}, ${
              current ? "current" : done ? "complete" : "upcoming"
            }`}
            aria-current={current ? "step" : undefined}
            className={`${current ? "current" : ""} ${done ? "done" : ""}`}
          >
            <span>{done ? <Check size={11} /> : index + 1}</span>
            <small>{step}</small>
          </div>
        );
      })}
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
  confidence,
  setConfidence,
}: {
  spec: ExperimentSpec;
  selected: string | null;
  setSelected: (value: string) => void;
  onRun: () => void;
  counterfactual: boolean;
  running: boolean;
  confidence: number;
  setConfidence: (value: number) => void;
}) {
  const testChange = spec.prediction.testChange;
  const change = testChange
    ? describeExperimentChange(spec, testChange.targetPath, testChange.value)
    : null;

  return (
    <div className="panel-content prediction-panel">
      <p className="panel-kicker">{counterfactual ? "CHANGE ONE VARIABLE" : "COMMIT BEFORE YOU SEE"}</p>
      <h2>{spec.prediction.prompt}</h2>
      <p className="panel-support">Choose an outcome before the world moves. You can revise your model after you see the evidence.</p>
      <div className="run-settings" aria-label="Current run settings">
        <small>CURRENT RUN SETTINGS</small>
        <div>
          {spec.controls.slice(0, 4).map((control) => (
            <span key={control.id}>
              {control.label}: <b>{control.value.toFixed(precisionForStep(control.step))}{control.unit ? ` ${control.unit}` : ""}</b>
            </span>
          ))}
        </div>
      </div>
      {testChange && change && (
        <div className="test-change" aria-label={`Only ${change.label} changes to ${testChange.value}${change.unit ? ` ${change.unit}` : ""}`}>
          <small>ONE VARIABLE CHANGES</small>
          <strong>{change.label}</strong>
          <ArrowRight size={13} />
          <span>{testChange.value}{change.unit ? ` ${change.unit}` : ""}</span>
        </div>
      )}
      <div className="choice-list">
        {spec.prediction.choices.map((choice, index) => (
          <button
            key={choice.id}
            className={selected === choice.id ? "selected" : ""}
            aria-pressed={selected === choice.id}
            disabled={running}
            onClick={() => setSelected(choice.id)}
          >
            <span>{String.fromCharCode(65 + index)}</span>
            {choice.label}
            {selected === choice.id && <Check size={15} />}
          </button>
        ))}
      </div>
      <div className="confidence-control">
        <div>
          <label htmlFor="prediction-confidence">How confident are you?</label>
          <output htmlFor="prediction-confidence">{confidence}%</output>
        </div>
        <input
          id="prediction-confidence"
          type="range"
          min="0"
          max="100"
          step="1"
          value={confidence}
          disabled={running}
          style={{
            background: `linear-gradient(90deg, var(--orange) 0 ${confidence}%, #25343c ${confidence}%) center / 100% 3px no-repeat`,
          }}
          onChange={(event) => setConfidence(Number(event.target.value))}
        />
        <div className="confidence-labels" aria-hidden="true">
          <span>Not sure</span><span>Neutral</span><span>Very sure</span>
        </div>
      </div>
      <button className="run-button" disabled={!selected || running} onClick={onRun}>
        <LockKeyhole size={16} /> {running ? "Experiment running" : "Lock prediction & run"}
      </button>
    </div>
  );
}

function chartTitle(spec: ExperimentSpec) {
  if (spec.scene.family === "drop") {
    return isVelocityFocusedDrop(spec) ? "Speed vs. time" : "Height vs. time";
  }
  if (spec.scene.family === "projectile") {
    return "Position and height vs. time";
  }
  if (spec.scene.family === "sandbox") {
    return "Tracked motion vs. time";
  }
  return "Angle and speed vs. time";
}

function precisionForStep(step: number) {
  const decimal = step.toString().split(".")[1];
  return Math.min(decimal?.length ?? 0, 3);
}

function EvidencePanel({
  spec,
  evidence,
  predictionLabel,
  predictionConfidence,
  predictionCorrect,
  explanation,
  setExplanation,
  onEvaluate,
  onOfflineEvaluate,
  evaluating,
  evaluationError,
}: {
  spec: ExperimentSpec;
  evidence: SimulationEvidence;
  predictionLabel: string;
  predictionConfidence: number;
  predictionCorrect: boolean;
  explanation: string;
  setExplanation: (value: string) => void;
  onEvaluate: () => void;
  onOfflineEvaluate: () => void;
  evaluating: boolean;
  evaluationError: string | null;
}) {
  return (
    <div className="panel-content evidence-panel">
      <section className="notebook-recap">
        <div><span>YOUR PREDICTION</span><Pencil size={13} aria-hidden="true" /></div>
        <p>I predicted <strong>{predictionLabel.toLowerCase()}</strong>.</p>
        <p className={`calibration-note ${predictionCorrect ? "supported" : "reconsider"}`}>
          <CircleGauge size={14} aria-hidden="true" />
          You were {predictionConfidence}% confident. The measured outcome {predictionCorrect ? "supported" : "contradicted"} that prediction.
        </p>
      </section>
      <div className="evidence-status"><span><Check size={13} /></span> RUN 1 · EXPERIMENT COMPLETE</div>
      <h2>What the world showed</h2>
      <p className="observed-copy">{evidence.summary}</p>
      <div className="metric-grid">
        <div><small>{evidence.metricA.label}</small><strong>{evidence.metricA.value}</strong></div>
        <div><small>{evidence.metricB.label}</small><strong>{evidence.metricB.value}</strong></div>
      </div>
      <button
        type="button"
        className="evidence-jump"
        onClick={() =>
          document
            .getElementById("student-explanation")
            ?.scrollIntoView({ behavior: "smooth", block: "center" })
        }
      >
        Explain this result <ArrowRight size={14} />
      </button>
      <div className="chart-heading"><span>{chartTitle(spec)}</span><small>Recorded evidence</small></div>
      <EvidenceChart spec={spec} evidence={evidence} />
      <div className="insight-strip">
        <Lightbulb size={19} aria-hidden="true" />
        <div><strong>Evidence, not the answer</strong><p>{spec.misconception.description}</p></div>
      </div>
      <label htmlFor="student-explanation">What caused the result?</label>
      <textarea id="student-explanation" value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder={spec.prediction.reasoningPrompt} rows={3} />
      {evaluationError && (
        <div className="offline-feedback-offer">
          <p className="panel-error" role="alert">{evaluationError}</p>
          <button type="button" disabled={evaluating} onClick={onOfflineEvaluate}>
            Continue with an offline rubric
          </button>
          <small>This backup is rules-based and will be labeled in the feedback.</small>
        </div>
      )}
      <button className="primary-panel-button" disabled={explanation.trim().length < 12 || evaluating} onClick={onEvaluate}>
        {evaluating ? "Asking the AI evaluator…" : "Check my explanation"} <ArrowRight size={16} />
      </button>
    </div>
  );
}

function FeedbackPanel({
  spec,
  evidence,
  predictionLabel,
  evaluation,
  evaluationOffline,
  onChallenge,
}: {
  spec: ExperimentSpec;
  evidence: SimulationEvidence;
  predictionLabel: string;
  evaluation: EvaluationResponse;
  evaluationOffline: boolean;
  onChallenge: () => void;
}) {
  const next = spec.counterfactuals[0];
  return (
    <div className="panel-content feedback-panel">
      <section className="notebook-recap">
        <div><span>YOUR PREDICTION</span><Pencil size={13} aria-hidden="true" /></div>
        <p>I predicted <strong>{predictionLabel.toLowerCase()}</strong>.</p>
      </section>
      <section className="notebook-observed">
        <span>WHAT WE OBSERVED</span>
        <p>{evidence.summary}</p>
      </section>
      <div className="chart-heading"><span>{chartTitle(spec)}</span><small>Run 1 evidence</small></div>
      <EvidenceChart spec={spec} evidence={evidence} />
      <div className="insight-strip validated">
        <BadgeCheck size={20} aria-hidden="true" />
        <div>
          <strong>
            {evaluationOffline ? "Offline rubric check" : "AI insight validated"} · {Math.round(evaluation.score * 100)}% reasoning match
          </strong>
          <p>{evaluation.feedback}</p>
        </div>
      </div>
      <div className="counterfactual-heading"><span>CHANGE ONE VARIABLE</span><small>Test a counterfactual.</small></div>
      <div className="counterfactual-action">
        <Wind size={24} aria-hidden="true" />
        <div><strong>{next?.title ?? "Try a new condition"}</strong><p>{next?.prompt ?? evaluation.hint}</p></div>
        <button type="button" onClick={onChallenge}>Change one variable <ArrowRight size={15} /></button>
      </div>
    </div>
  );
}

function CompletePanel({
  spec,
  firstCorrect,
  transferCorrect,
  masteryStart,
  firstMastery,
  mastery,
  firstConfidence,
  transferConfidence,
  firstEvidence,
  transferEvidence,
  transferChange,
  onRestart,
}: {
  spec: ExperimentSpec;
  firstCorrect: boolean;
  transferCorrect: boolean;
  masteryStart: number;
  firstMastery: number;
  mastery: number;
  firstConfidence: number;
  transferConfidence: number;
  firstEvidence: SimulationEvidence | null;
  transferEvidence: SimulationEvidence | null;
  transferChange: ExperimentChange | null;
  onRestart: () => void;
}) {
  const state = firstCorrect && transferCorrect
    ? {
        kicker: "MODEL TRANSFERRED",
        heading: <>You predicted it.<br />Then transferred it.</>,
        summary: "Both locked predictions matched the measured outcomes.",
      }
    : !firstCorrect && transferCorrect
      ? {
          kicker: "MENTAL MODEL REVISED",
          heading: <>The evidence changed<br />your next prediction.</>,
          summary: "Run 1 exposed the misconception, and Run 2 showed successful transfer.",
        }
      : {
          kicker: "MODEL STILL EVOLVING",
          heading: <>You tested it.<br />Now refine it.</>,
          summary: "At least one measured outcome still disagrees with the current model.",
        };
  const heldConstant = spec.controls
    .filter((control) => control.targetPath !== transferChange?.targetPath)
    .map((control) => control.label)
    .slice(0, 3);
  const formatChangedValue = (value: number | string, unit: string) =>
    `${value}${unit ? `${unit === "°" || unit === "%" ? "" : " "}${unit}` : ""}`;
  const formattedChange = transferChange
    ? `${transferChange.label}: ${formatChangedValue(transferChange.before ?? "baseline", transferChange.unit)} → ${formatChangedValue(transferChange.after, transferChange.unit)}`
    : "One declared variable changed";

  return (
    <div className="panel-content complete-panel">
      <div className="completion-spark"><Sparkles size={24} /></div>
      <p className="panel-kicker">{state.kicker}</p>
      <h2>{state.heading}</h2>
      <p className="completion-summary">{state.summary}</p>
      <div className="mastery-card">
        <div><small>{spec.misconception.title}</small><strong>{mastery}%</strong></div>
        <div className="mastery-track"><span style={{ width: `${mastery}%` }} /></div>
        <div className="mastery-trajectory" aria-label={`Mastery estimate changed from ${masteryStart}% to ${firstMastery}% after run 1 and ${mastery}% after run 2`}>
          <span>START <b>{masteryStart}%</b></span>
          <ArrowRight size={12} aria-hidden="true" />
          <span>RUN 1 <b>{firstMastery}%</b></span>
          <ArrowRight size={12} aria-hidden="true" />
          <span>RUN 2 <b>{mastery}%</b></span>
        </div>
        <div className="mastery-events">
          <span className={firstCorrect ? "correct" : "revised"}>{firstCorrect ? <Check size={12} /> : <RotateCcw size={12} />} First prediction: {firstCorrect ? "correct" : "needs revision"}</span>
          <span className={transferCorrect ? "correct" : "revised"}>{transferCorrect ? <Check size={12} /> : <RotateCcw size={12} />} Transfer test: {transferCorrect ? "correct" : "needs revision"}</span>
        </div>
        <p className="mastery-explanation">
          This Bayesian estimate uses both locked predictions: matches raise the estimate; misses lower it and mark what to revisit.
        </p>
      </div>
      <section className="run-comparison" aria-labelledby="run-comparison-title">
        <div>
          <span>CONTROLLED COMPARISON</span>
          <h3 id="run-comparison-title">Run 1 vs Run 2</h3>
        </div>
        <p className="comparison-change"><strong>Changed:</strong> {formattedChange}</p>
        {heldConstant.length > 0 && (
          <p className="comparison-controls"><strong>Held constant:</strong> {heldConstant.join(", ")}</p>
        )}
        <div className="comparison-runs">
          <article>
            <span>RUN 1 · {firstCorrect ? "MATCHED" : "MISSED"}</span>
            <strong>{firstConfidence}% confident</strong>
            {firstEvidence && (
              <dl className="comparison-metrics">
                <div><dt>{firstEvidence.metricA.label}</dt><dd>{firstEvidence.metricA.value}</dd></div>
                <div><dt>{firstEvidence.metricB.label}</dt><dd>{firstEvidence.metricB.value}</dd></div>
              </dl>
            )}
            <p>{firstEvidence?.summary ?? "Evidence was captured in the first run."}</p>
          </article>
          <article>
            <span>RUN 2 · {transferCorrect ? "MATCHED" : "MISSED"}</span>
            <strong>{transferConfidence}% confident</strong>
            {transferEvidence && (
              <dl className="comparison-metrics">
                <div><dt>{transferEvidence.metricA.label}</dt><dd>{transferEvidence.metricA.value}</dd></div>
                <div><dt>{transferEvidence.metricB.label}</dt><dd>{transferEvidence.metricB.value}</dd></div>
              </dl>
            )}
            <p>{transferEvidence?.summary ?? "Evidence was captured in the transfer run."}</p>
          </article>
        </div>
      </section>
      <blockquote>“What changed in your model of the world?”</blockquote>
      <p className="complete-copy">The next time you meet this idea, you have measured evidence—not just an answer.</p>
      <button className="primary-panel-button" onClick={onRestart}>Build another world <ArrowRight size={16} /></button>
    </div>
  );
}

function LabWorkspace({
  spec,
  setSpec,
  question,
  phase,
  setPhase,
  onExit,
  compilerNotice,
}: {
  spec: ExperimentSpec;
  setSpec: (spec: ExperimentSpec) => void;
  question: string;
  phase: Phase;
  setPhase: (phase: Phase) => void;
  onExit: () => void;
  compilerNotice: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);
  const [paused, setPaused] = useState(false);
  const [runToken, setRunToken] = useState(0);
  const [evidence, setEvidence] = useState<SimulationEvidence | null>(null);
  const [explanation, setExplanation] = useState("");
  const [evaluation, setEvaluation] = useState<EvaluationResponse | null>(null);
  const [evaluationOffline, setEvaluationOffline] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [firstCorrect, setFirstCorrect] = useState(false);
  const [transferCorrect, setTransferCorrect] = useState(false);
  const [confidence, setConfidence] = useState(62);
  const [firstConfidence, setFirstConfidence] = useState(62);
  const [transferConfidence, setTransferConfidence] = useState(50);
  const [firstEvidence, setFirstEvidence] = useState<SimulationEvidence | null>(null);
  const [transferChange, setTransferChange] = useState<ExperimentChange | null>(null);
  const [transferMode, setTransferMode] = useState(false);
  const [mastery, setMastery] = useState(25);
  const [masteryStart, setMasteryStart] = useState(25);
  const [firstMastery, setFirstMastery] = useState(25);
  const [simulationExpanded, setSimulationExpanded] = useState(false);
  const [cameraCommand, setCameraCommand] = useState<CameraCommand>({
    type: "reset",
    token: 0,
  });
  const preRunSpec = useRef(spec);
  const simulationStage = useRef<HTMLElement>(null);
  const learningPanel = useRef<HTMLElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const commandCamera = useCallback((type: CameraCommand["type"]) => {
    setCameraCommand((current) => ({ type, token: current.token + 1 }));
  }, []);

  useEffect(() => {
    const storedMastery = Math.round(
      masteryProbability(spec.misconception.id) * 100,
    );
    setMastery(storedMastery);
    setMasteryStart(storedMastery);
    setFirstMastery(storedMastery);
  }, [spec.misconception.id]);

  useEffect(() => {
    if (!simulationExpanded) return;
    const previousOverflow = document.body.style.overflow;
    const expandedViewButton = expandButton.current;
    const backgroundElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".site-header, .lab-topline, .learning-panel, .lab-mastery-footer",
      ),
    );
    const previousBackgroundState = backgroundElements.map((element) => ({
      element,
      ariaHidden: element.getAttribute("aria-hidden"),
      inert: element.inert,
    }));
    const handleExpandedKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSimulationExpanded(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        simulationStage.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    backgroundElements.forEach((element) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });
    window.addEventListener("keydown", handleExpandedKeyboard);
    window.requestAnimationFrame(() => expandedViewButton?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      previousBackgroundState.forEach(({ element, ariaHidden, inert }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      window.removeEventListener("keydown", handleExpandedKeyboard);
      window.requestAnimationFrame(() => expandedViewButton?.focus());
    };
  }, [simulationExpanded]);

  useEffect(() => {
    if (phase !== "explaining" || !evaluation) return;
    const panel = learningPanel.current;
    const notebook = panel?.querySelector<HTMLElement>(".notebook-scroll");
    window.requestAnimationFrame(() => {
      notebook?.scrollTo({ top: notebook.scrollHeight, behavior: "smooth" });
    });
    if (!panel || window.innerWidth > 1040) return;
    const timeout = window.setTimeout(() => {
      const top = panel.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: Math.max(0, top - 8), behavior: "auto" });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [evaluation, phase]);

  useEffect(() => {
    const handleWorkspaceShortcuts = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "0") {
        event.preventDefault();
        commandCamera("reset");
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSimulationExpanded((value) => !value);
      }
    };
    window.addEventListener("keydown", handleWorkspaceShortcuts);
    return () => window.removeEventListener("keydown", handleWorkspaceShortcuts);
  }, [commandCamera]);

  const capturing = phase === "running" || phase === "counterfactual-running";
  const counterfactual = transferMode || phase === "counterfactual-predicting" || phase === "counterfactual-running";
  const chosen = spec.prediction.choices.find((choice) => choice.id === selected);
  const predictionLabel = chosen?.label ?? "an outcome that is still being tested";
  const canEditControls = !launched && phase === "predicting";
  const reservedControlPath = canEditControls
    ? spec.prediction.testChange?.targetPath
    : undefined;
  const hasRun = launched || Boolean(evidence);
  const showOutcomeGuides =
    Boolean(evidence) &&
    (phase === "evidence" || phase === "explaining" || phase === "complete");
  const environment =
    spec.scene.family === "drop"
      ? {
          name: spec.scene.airDensity > 0 ? "Air (Earth)" : "Vacuum",
          density: spec.scene.airDensity,
        }
      : spec.scene.family === "projectile"
        ? {
            name:
              spec.scene.object.dragCoefficient > 0
                ? "Air (Earth)"
                : "Vacuum",
            density:
              spec.scene.object.dragCoefficient > 0
                ? PROJECTILE_AIR_DENSITY_KG_PER_CUBIC_METER
                : 0,
          }
        : spec.scene.family === "sandbox"
          ? {
              name:
                spec.scene.centralGravity > 0
                  ? "Orbital field"
                  : spec.scene.airDensity > 0
                    ? "Air"
                    : "Vacuum",
              density: spec.scene.airDensity,
            }
          : { name: "Idealized lab", density: 0 };
  const legendItems = sceneLegend(spec);

  const run = () => {
    if (!selected || capturing) return;
    if (counterfactual) setTransferConfidence(confidence);
    else setFirstConfidence(confidence);
    preRunSpec.current = spec;
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
    setPaused(false);
    setPhase(counterfactual ? "counterfactual-running" : "running");
  };

  const onComplete = useCallback(
    (result: SimulationEvidence) => {
      setEvidence(result);
      setLaunched(false);
      setPaused(false);
      const correct = chosen?.outcomeKey === result.outcomeKey;
      if (phase === "running") {
        setFirstCorrect(correct);
        setFirstEvidence(result);
        const nextMastery = Math.round(
          recordMasteryObservation(spec.misconception.id, correct) * 100,
        );
        setFirstMastery(nextMastery);
        setMastery(nextMastery);
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

  const evaluate = async (mode: "ai" | "offline" = "ai") => {
    setEvaluating(true);
    setEvaluationError(null);
    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(mode === "offline"
            ? { "x-counterfactual-feedback-mode": "heuristic" }
            : {}),
        },
        body: JSON.stringify({
          experimentId: spec.id,
          observedOutcome: evidence?.outcomeKey,
          question,
          objective: spec.objective,
          evidenceSummary: evidence?.summary,
          studentExplanation: explanation,
          misconception: spec.misconception,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setEvaluationError(
          payload?.error?.message ??
            "The AI evaluator could not respond. Please retry.",
        );
        return;
      }
      const data = (await response.json()) as EvaluationResponse;
      setEvaluation(data);
      setEvaluationOffline(mode === "offline");
      setPhase("explaining");
    } catch {
      setEvaluationError("The AI evaluator could not be reached. Please retry.");
    } finally {
      setEvaluating(false);
    }
  };

  const beginCounterfactual = () => {
    const next = spec.counterfactuals[0];
    if (!next) {
      setPhase("complete");
      return;
    }
    const baselineSpec = preRunSpec.current;
    setTransferChange(
      describeExperimentChange(
        baselineSpec,
        next.change.targetPath,
        next.change.value,
      ),
    );
    const counterfactualSpec = applyCounterfactual(baselineSpec, next);
    preRunSpec.current = counterfactualSpec;
    setSpec(counterfactualSpec);
    setTransferMode(true);
    setSelected(null);
    setConfidence(50);
    setExplanation("");
    setEvidence(null);
    setLaunched(false);
    setPaused(false);
    setEvaluation(null);
    setEvaluationOffline(false);
    setRunToken((value) => value + 1);
    setPhase("counterfactual-predicting");
  };

  const changeControl = (id: string, value: number) => {
    const control = spec.controls.find((item) => item.id === id);
    if (!control) return;
    const nextValue = Math.min(control.max, Math.max(control.min, value));
    const updated = updateScenePath(spec, control.targetPath, nextValue);
    const nextSpec = { ...updated, controls: updated.controls.map((item) => (item.id === id ? { ...item, value: nextValue } : item)) };
    preRunSpec.current = nextSpec;
    setSpec(nextSpec);
    setRunToken((token) => token + 1);
  };

  const resetSimulation = () => {
    setSpec(preRunSpec.current);
    setLaunched(false);
    setPaused(false);
    setEvidence(null);
    setRunToken((value) => value + 1);
    commandCamera("reset");
    setPhase(counterfactual ? "counterfactual-predicting" : "predicting");
  };

  const clearRun = () => {
    resetSimulation();
    setSelected(null);
    setExplanation("");
    setEvaluation(null);
    setEvaluationOffline(false);
    setEvaluationError(null);
    if (!counterfactual) {
      setFirstEvidence(null);
      setFirstCorrect(false);
      setFirstMastery(masteryStart);
      setConfidence(62);
    } else {
      setTransferCorrect(false);
      setConfidence(50);
    }
  };

  const jumpToPrediction = () => {
    const panel = learningPanel.current;
    if (!panel) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    panel.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
    window.requestAnimationFrame(() => {
      panel
        .querySelector<HTMLElement>(".choice-list button:not([disabled])")
        ?.focus({ preventScroll: true });
    });
  };

  const replay = () => {
    if (!selected || capturing) return;
    setEvidence(null);
    setPaused(false);
    setLaunched(true);
    setRunToken((value) => value + 1);
    setPhase(counterfactual ? "counterfactual-running" : "running");
  };

  return (
    <main id="main-content" className="lab-workspace" tabIndex={-1}>
      <div className="lab-topline">
        <div className="lab-title-block">
          <div>
            <h1>{question}</h1>
            <div className="experiment-meta">
              <span>Experiment:</span>
              <h2>{spec.title}</h2>
              <i aria-hidden="true" />
              <span>{counterfactual ? "Run 2 of 2" : "Run 1 of 2"}</span>
              {compilerNotice && (
                <span className="compiler-notice-mobile">
                  <ShieldCheck size={11} aria-hidden="true" /> {compactCompilerNotice(compilerNotice)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="lab-context">
          {compilerNotice && <span className="compiler-notice"><ShieldCheck size={13} /> {compilerNotice}</span>}
          <div className="environment-summary" aria-label={`Environment: ${environment.name}`}>
            <span><small>ENVIRONMENT</small>{environment.name}</span>
            <ShieldCheck size={14} aria-hidden="true" />
          </div>
        </div>
      </div>

      <div className="lab-grid">
        <section
          ref={simulationStage}
          className={`simulation-stage ${simulationExpanded ? "simulation-stage-expanded" : ""}`}
          role={simulationExpanded ? "dialog" : undefined}
          aria-modal={simulationExpanded || undefined}
          aria-label={simulationExpanded ? "Expanded simulation view" : undefined}
        >
          <div className="stage-toolbar">
            <div role="status" aria-live="polite" aria-atomic="true"><span className="status-light" /> {capturing ? paused ? "SIMULATION PAUSED" : "SIMULATION RUNNING" : hasRun ? "EVIDENCE CAPTURED" : "WORLD READY"}</div>
            <div className="stage-tools">
              <span><Crosshair size={11} aria-hidden="true" /> drag to orbit · scroll to point · right-drag to pan</span>
              <button type="button" title="Zoom in" aria-label="Zoom simulation in" onClick={() => commandCamera("zoom-in")}><ZoomIn size={14} /></button>
              <button type="button" title="Zoom out" aria-label="Zoom simulation out" onClick={() => commandCamera("zoom-out")}><ZoomOut size={14} /></button>
              <button type="button" title="Recenter view (0)" aria-label="Recenter simulation view" onClick={() => commandCamera("reset")}><Crosshair size={14} /></button>
              <button type="button" aria-label="Reset simulation" onClick={resetSimulation}><RotateCcw size={14} /></button>
              <button
                ref={expandButton}
                type="button"
                aria-label={simulationExpanded ? "Exit expanded simulation view" : "Expand simulation view"}
                aria-expanded={simulationExpanded}
                onClick={() => setSimulationExpanded((value) => !value)}
              >
                {simulationExpanded ? <Minimize2 size={14} /> : <Expand size={14} />}
              </button>
            </div>
          </div>
          <div
            className={`canvas-shell ${launched || showOutcomeGuides ? "telemetry-visible" : ""}`}
          >
            <SimulationErrorBoundary resetKey={`${spec.id}-${runToken}`}>
              <ExperimentCanvas
                spec={spec}
                runToken={runToken}
                launched={launched}
                capturing={capturing}
                paused={paused}
                showOutcomeGuides={showOutcomeGuides}
                cameraCommand={cameraCommand}
                onComplete={onComplete}
              />
            </SimulationErrorBoundary>
            <div className="experiment-readout">
              <small>EXPERIMENT</small>
              <strong>{spec.title}</strong>
              <span><i className="status-light" /> {hasRun ? "Completed" : "Compiled"}</span>
            </div>
            <div className="environment-readout">
              <span><i>g</i> {spec.scene.gravity.toFixed(2)} m/s²</span>
              <span><i>ρ</i> {environment.density.toFixed(3)} kg/m³</span>
            </div>
            <div className="canvas-vignette-copy"><p>{spec.sourceSummary}</p></div>
            <div className="scene-legend" aria-label="Scientific measurement legend">
              <small>MEASUREMENT KEY</small>
              <div>
                {legendItems.map((item) => (
                  <span key={item.id}>
                    <i style={{ background: item.color, color: item.color }} />
                    {item.label}
                  </span>
                ))}
              </div>
              <b>Evidence sampled over time · SI units</b>
            </div>
            {capturing && <div className="capture-badge"><span />{paused ? <Play size={12} /> : <Pause size={12} />} {paused ? "observation paused" : "collecting evidence"}</div>}
          </div>
          <div className="replay-bar" aria-label="Simulation playback controls">
            <button
              type="button"
              className="playback-button"
              disabled={!hasRun}
              aria-label={capturing ? paused ? "Resume simulation" : "Pause simulation" : "Replay experiment"}
              onClick={() => capturing ? setPaused((value) => !value) : replay()}
            >
              {capturing && !paused ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
            <span className="time-readout"><Timer size={14} /> {capturing ? paused ? "Paused" : "Recording live" : evidence ? `${evidence.duration.toFixed(2)} s captured` : "0.00 s / ready"}</span>
            <div className={`timeline-track ${capturing ? "recording" : evidence ? "complete" : ""} ${paused ? "paused" : ""}`}><span /></div>
            <span className="playback-rate">1×</span>
            <button type="button" className="timeline-reset" aria-label="Reset experiment" onClick={resetSimulation}><RotateCcw size={15} /></button>
          </div>
          <div className="control-deck">
            <div className="control-heading">
              <span><CircleGauge size={15} /> CONTROLLED VARIABLES</span>
              <small>{canEditControls ? "change one thing at a time" : counterfactual ? "locked for transfer test" : "locked for this run"}</small>
              {(phase === "predicting" || phase === "counterfactual-predicting") && (
                <button
                  type="button"
                  className="prediction-jump"
                  aria-controls="hypothesis-notebook"
                  onClick={jumpToPrediction}
                >
                  Make prediction <ArrowRight size={13} aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="controls-grid">
              {spec.controls.map((control, index) => {
                const reservedForRun = control.targetPath === reservedControlPath;
                const disabled = !canEditControls || reservedForRun;
                return (
                  <div key={control.id} className={`variable-control variable-${index + 1} ${reservedForRun ? "reserved-control" : ""}`}>
                    <label htmlFor={`control-${control.id}`}>
                      {control.label}
                      {reservedForRun && <small>tested in this run</small>}
                    </label>
                    <div className="stepper-control">
                      <button type="button" disabled={disabled || control.value <= control.min} aria-label={`Decrease ${control.label}`} onClick={() => changeControl(control.id, control.value - control.step)}><Minus size={14} /></button>
                      <output htmlFor={`control-${control.id}`}>{control.value.toFixed(precisionForStep(control.step))}</output>
                      <button type="button" disabled={disabled || control.value >= control.max} aria-label={`Increase ${control.label}`} onClick={() => changeControl(control.id, control.value + control.step)}><Plus size={14} /></button>
                      <span>{control.unit}</span>
                    </div>
                    <input id={`control-${control.id}`} type="range" min={control.min} max={control.max} step={control.step} value={control.value} disabled={disabled} aria-describedby={reservedForRun ? `reserved-${control.id}` : undefined} onChange={(event) => changeControl(control.id, Number(event.target.value))} />
                    {reservedForRun && <span id={`reserved-${control.id}`} className="sr-only">This variable is locked because the prediction tests its displayed change.</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <aside
          ref={learningPanel}
          id="hypothesis-notebook"
          className="learning-panel"
          aria-labelledby="notebook-title"
        >
          <div className="notebook-header">
            <div id="notebook-title"><FlaskConical size={17} /><span>{phase === "predicting" || phase === "counterfactual-predicting" ? "HYPOTHESIS NOTEBOOK" : "EVIDENCE NOTEBOOK"}</span></div>
            <button type="button" onClick={clearRun}><RotateCcw size={13} /> Clear run</button>
          </div>
          <div className="notebook-scroll">
            {(phase === "predicting" || phase === "counterfactual-predicting" || phase === "running" || phase === "counterfactual-running") && (
              <PredictionPanel
                spec={spec}
                selected={selected}
                setSelected={setSelected}
                onRun={run}
                counterfactual={counterfactual}
                running={capturing}
                confidence={confidence}
                setConfidence={setConfidence}
              />
            )}
            {phase === "evidence" && evidence && <EvidencePanel spec={spec} evidence={evidence} predictionLabel={predictionLabel} predictionConfidence={firstConfidence} predictionCorrect={firstCorrect} explanation={explanation} setExplanation={setExplanation} onEvaluate={() => evaluate("ai")} onOfflineEvaluate={() => evaluate("offline")} evaluating={evaluating} evaluationError={evaluationError} />}
            {phase === "explaining" && evaluation && evidence && <FeedbackPanel spec={spec} evidence={evidence} predictionLabel={predictionLabel} evaluation={evaluation} evaluationOffline={evaluationOffline} onChallenge={beginCounterfactual} />}
            {phase === "complete" && <CompletePanel spec={spec} firstCorrect={firstCorrect} transferCorrect={transferCorrect} masteryStart={masteryStart} firstMastery={firstMastery} mastery={mastery} firstConfidence={firstConfidence} transferConfidence={transferConfidence} firstEvidence={firstEvidence} transferEvidence={evidence} transferChange={transferChange} onRestart={onExit} />}
          </div>
          {capturing && (
            <div className="running-overlay" role="status" aria-live="polite" aria-atomic="true">
              <Timer size={42} strokeWidth={1.2} aria-hidden="true" />
              <p>Reality is answering</p>
              <small>{paused ? "Observation paused" : "Measuring at 10 samples / second"}</small>
              <div className="live-sample-strip"><span>POSITION</span><strong>LIVE</strong><span>VELOCITY</span></div>
            </div>
          )}
        </aside>
      </div>
      <footer className="lab-mastery-footer">
        <BadgeCheck size={15} />
        <strong>MASTERY NOTE</strong>
        <span>{phase === "complete" ? "You transferred the idea to a changed world." : `You are testing: ${spec.misconception.title.toLowerCase()}.`}</span>
        <div className="footer-mastery-track" aria-label={`${mastery}% mastery`}><i style={{ width: `${mastery}%` }} /></div>
        <b>{mastery}%</b>
      </footer>
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
  const [validatedExampleOffer, setValidatedExampleOffer] =
    useState<ValidatedExampleOffer | null>(null);
  const [spec, setSpec] = useState<ExperimentSpec>(dropDemo);
  const [exitConfirmationOpen, setExitConfirmationOpen] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [phase]);

  useEffect(() => {
    if (phase !== "compiling") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [phase]);

  const reset = () => {
    setExitConfirmationOpen(false);
    setPhase("input");
    setError(null);
    setCompilerNotice(null);
    setValidatedExampleOffer(null);
    setPrompt("");
    setImage(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
  };

  const compile = async (promptOverride?: string) => {
    const requestedPrompt = promptOverride?.trim() || prompt.trim();
    if (promptOverride) setPrompt(promptOverride);
    if (requestedPrompt.length > MAX_QUESTION_LENGTH) {
      setError(`Keep the question to ${MAX_QUESTION_LENGTH} characters or fewer.`);
      setPhase("input");
      return;
    }
    setError(null);
    setCompilerNotice(null);
    setValidatedExampleOffer(null);
    setPhase("compiling");
    setStage(0);
    let generated: ExperimentSpec | null = null;
    let compileFailure: string | null = null;
    let nextValidatedExampleOffer: ValidatedExampleOffer | null = null;
    let nextCompilerNotice: string | null = null;
    const compileRequest = async () => {
      const form = new FormData();
      form.set("prompt", requestedPrompt || "Explain the mechanics in this diagram.");
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
            "The experiment failed its final safety check. Please retry.";
          nextValidatedExampleOffer = {
            spec: demoForPrompt(requestedPrompt),
            warning:
              "Your question will not be relabeled. This opens a separate, pre-validated mechanics example.",
          };
          return;
        }
        if (payload.provenance.source !== "generated") {
          compileFailure =
            "AI generation was unavailable, so your question was not replaced with a generic experiment. Retry AI or explicitly open the separate demo below.";
          nextValidatedExampleOffer = {
            spec: parsed.data,
            warning:
              payload.warnings[0] ??
              "This is a separate, pre-validated mechanics example and was not generated for your question.",
          };
          return;
        }
        generated = parsed.data;
        if (payload.warnings.length > 0) {
          nextCompilerNotice = payload.warnings.join(" ");
        } else {
          nextCompilerNotice = `AI-generated${payload.provenance.model ? ` with ${payload.provenance.model}` : ""} · physics validated`;
        }
      } catch {
        compileFailure =
          "The AI experiment generator could not be reached. Your question was not replaced. Retry AI or explicitly open the separate demo below.";
        nextValidatedExampleOffer = {
          spec: demoForPrompt(requestedPrompt),
          warning:
            "This is a separate, pre-validated mechanics example and was not generated for your question.",
        };
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
      setValidatedExampleOffer(nextValidatedExampleOffer);
      setPhase("input");
      return;
    }
    if (!generated) {
      setError(
        "The AI did not return an experiment. Please retry or rephrase the question.",
      );
      setValidatedExampleOffer({
        spec: demoForPrompt(requestedPrompt),
        warning:
          "This is a separate, pre-validated mechanics example and was not generated for your question.",
      });
      setPhase("input");
      return;
    }
    setCompilerNotice(nextCompilerNotice);
    setValidatedExampleOffer(null);
    setSpec(structuredClone(generated));
    setImage(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setPhase("predicting");
  };

  const openExample = (
    selectedSpec: ExperimentSpec,
    notice = "Validated demo example · explicitly selected · pre-coded, not AI-generated",
  ) => {
    const example = structuredClone(selectedSpec);
    setPrompt(canonicalQuestionFor(example));
    setCompilerNotice(notice);
    setSpec(example);
    setError(null);
    setValidatedExampleOffer(null);
    setImage(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setPhase("predicting");
  };

  const openValidatedExample = () => {
    if (!validatedExampleOffer) return;
    openExample(
      validatedExampleOffer.spec,
      "Validated demo example · explicitly selected · not generated for the prior question",
    );
  };

  const inLab = phase !== "input" && phase !== "compiling";
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Header
        inLab={inLab}
        phase={phase}
        onExit={() => inLab ? setExitConfirmationOpen(true) : reset()}
      />
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
          validatedExampleOffer={validatedExampleOffer}
          openValidatedExample={openValidatedExample}
          openExample={openExample}
          compile={compile}
        />
      )}
      {phase === "compiling" && <><Landing prompt={prompt} setPrompt={setPrompt} gradeBand={gradeBand} setGradeBand={setGradeBand} image={image} imagePreview={imagePreview} setImage={setImage} setImagePreview={setImagePreview} error={error} setError={setError} validatedExampleOffer={validatedExampleOffer} openValidatedExample={openValidatedExample} openExample={openExample} compile={compile} /><CompilerOverlay stage={stage} /></>}
      {inLab && (
        <LabWorkspace
          key={spec.id}
          spec={spec}
          setSpec={setSpec}
          question={prompt.trim() || spec.objective}
          phase={phase}
          setPhase={setPhase}
          onExit={reset}
          compilerNotice={compilerNotice}
        />
      )}
      <ExitConfirmation
        open={exitConfirmationOpen}
        onCancel={() => setExitConfirmationOpen(false)}
        onConfirm={reset}
      />
    </div>
  );
}
