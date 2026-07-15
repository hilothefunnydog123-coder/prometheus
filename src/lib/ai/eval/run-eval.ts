import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeInput } from "../analyze-input";
import { compileExperiment } from "../compile-experiment";
import { getFeatherlessConfig } from "../config";
import { EVAL_DATASET } from "./dataset";

/**
 * Opt-in compiler evaluation: `npm run eval:compiler`.
 *
 * Runs the 30-case dataset through analyzeInput + compileExperiment and
 * records routing accuracy, schema pass rate, fallback rate, and latency.
 * With FEATHERLESS_API_KEY set this makes LIVE provider calls; without it,
 * it measures the deterministic offline path (schema pass rate will be 0%
 * and fallback rate 100% by construction — the report says which mode ran).
 *
 * This script must NEVER run in CI (guarded below) and is not imported by
 * any production or test code.
 */

interface CaseResult {
  id: string;
  expectedFamily: string;
  routedFamily: string;
  routedCorrectly: boolean;
  /** "generated" | "validated-example" | "rejected-422" */
  compileSource: string;
  warning?: string;
  latencyMs: number;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)] ?? 0;
}

async function main(): Promise<void> {
  if (process.env.CI) {
    console.error(
      "eval:compiler is opt-in and must not run in CI. Exiting without running.",
    );
    process.exit(1);
  }

  const live = getFeatherlessConfig() !== null;
  console.log(
    `Running compiler eval on ${EVAL_DATASET.length} cases in ${
      live ? "LIVE provider" : "OFFLINE deterministic-fallback"
    } mode...\n`,
  );

  const results: CaseResult[] = [];
  for (const evalCase of EVAL_DATASET) {
    const startedAt = Date.now();
    const intent = await analyzeInput(evalCase.text);
    const compiled =
      intent.family === "unknown"
        ? null // the API returns 422 for unsupported material
        : await compileExperiment(intent, { gradeBand: "8-10" });
    const latencyMs = Date.now() - startedAt;
    const source = compiled?.provenance.source ?? "rejected-422";
    results.push({
      id: evalCase.id,
      expectedFamily: evalCase.expectedFamily,
      routedFamily: intent.family,
      routedCorrectly: intent.family === evalCase.expectedFamily,
      compileSource: source,
      warning: compiled?.warnings[0],
      latencyMs,
    });
    console.log(
      `  ${evalCase.id.padEnd(28)} routed=${intent.family.padEnd(10)} source=${source.padEnd(18)} ${latencyMs}ms`,
    );
  }

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const routingAccuracy =
    results.filter((r) => r.routedCorrectly).length / results.length;
  const compiledResults = results.filter((r) => r.compileSource !== "rejected-422");
  const schemaPassRate =
    compiledResults.length === 0
      ? 0
      : compiledResults.filter((r) => r.compileSource === "generated").length /
        compiledResults.length;
  const fallbackRate =
    compiledResults.length === 0
      ? 0
      : compiledResults.filter((r) => r.compileSource === "validated-example")
          .length / compiledResults.length;

  const summary = {
    mode: live ? "live" : "offline",
    cases: results.length,
    routingAccuracy: Number(routingAccuracy.toFixed(3)),
    schemaPassRate: Number(schemaPassRate.toFixed(3)),
    fallbackRate: Number(fallbackRate.toFixed(3)),
    latencyMs: {
      mean: Math.round(
        latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
      ),
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
    },
  };

  console.log("\nSummary:");
  console.table(summary.latencyMs);
  console.log(
    `  routing accuracy: ${(summary.routingAccuracy * 100).toFixed(1)}%`,
  );
  console.log(
    `  schema pass rate: ${(summary.schemaPassRate * 100).toFixed(1)}%`,
  );
  console.log(`  fallback rate:    ${(summary.fallbackRate * 100).toFixed(1)}%`);

  const reportDir = join(process.cwd(), "eval-reports");
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(
    reportDir,
    `compiler-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  writeFileSync(reportPath, JSON.stringify({ summary, results }, null, 2));
  console.log(`\nReport written to ${reportPath}`);
}

main().catch((error: unknown) => {
  console.error("eval:compiler failed:", error);
  process.exit(1);
});
