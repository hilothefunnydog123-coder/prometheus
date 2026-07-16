"use client";

import type { EvaluationResult } from "@/lib/ai/contracts/evaluation";

const SCORE_LABELS: Array<{
  key: keyof EvaluationResult["evaluation"]["scores"];
  label: string;
}> = [
  { key: "correctness", label: "Correctness" },
  { key: "mechanism", label: "Mechanism" },
  { key: "vocabulary", label: "Vocabulary" },
];

export function RubricPanel({ result }: { result: EvaluationResult }) {
  const { evaluation, overall, masterySignal } = result;
  return (
    <div className="rubric" aria-label="Explanation feedback">
      <div>
        <span className={`badge ${masterySignal === "correct" ? "ok" : "bad"}`}>
          {masterySignal === "correct" ? "solid explanation" : "keep working it"}
        </span>{" "}
        <span className="hint">
          overall {Math.round(overall * 100)}% ·{" "}
          {result.source === "model" ? "graded by the AI rubric" : "graded offline"}
        </span>
      </div>
      {SCORE_LABELS.map(({ key, label }) => (
        <div className="score-row" key={key}>
          <span>{label}</span>
          <div className="track" aria-hidden>
            <div
              className="fill"
              style={{ width: `${(evaluation.scores[key] / 3) * 100}%` }}
            />
          </div>
          <span className="hint">{evaluation.scores[key]}/3</span>
        </div>
      ))}
      <div className="feedback">{evaluation.feedback}</div>
      {evaluation.misconceptions.length > 0 ? (
        <ul className="misconceptions">
          {evaluation.misconceptions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
