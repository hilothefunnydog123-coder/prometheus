"use client";

import { useEffect, useRef } from "react";
import type { ExperimentFamily } from "@/lib/ai/contracts/experiment-spec";
import type { TrajectoryPoint } from "@/lib/simulation";
import {
  boundsForTrajectories,
  fitBounds,
  type ViewTransform,
} from "@/lib/client/view-transform";

/**
 * 2D canvas renderer for a compiled experiment. Plays the base world (teal,
 * filled) and optionally a counterfactual world (amber ring) on the same
 * stage so "nothing changed" is visible as two markers moving in lockstep.
 *
 * Deterministic playback from precomputed trajectories — the canvas never
 * does physics. Honors prefers-reduced-motion by drawing the full paths
 * statically instead of animating.
 */

export interface ExperimentCanvasProps {
  family: ExperimentFamily;
  base: TrajectoryPoint[];
  patched?: TrajectoryPoint[] | null;
  /** Simulated seconds the playback loops over. */
  duration: number;
  baseLabel: string;
  patchedLabel?: string | null;
  /** Draw the t = 0 frame and hold — used before the learner predicts. */
  freezeAtStart?: boolean;
}

const BASE_COLOR = "#2dd4bf";
const PATCHED_COLOR = "#fbbf24";
const GROUND_COLOR = "rgba(148, 163, 184, 0.5)";
const TRAIL_ALPHA = 0.35;
/** Seconds to hold the final frame before the loop restarts. */
const HOLD_SECONDS = 0.8;

function pointAt(points: TrajectoryPoint[], simTime: number): TrajectoryPoint {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return { t: 0, x: 0, y: 0 };
  if (points.length < 2 || simTime <= 0) return first;
  const timestep = points[1]!.t - first.t;
  if (timestep <= 0) return first;
  const index = Math.min(Math.floor(simTime / timestep), points.length - 1);
  return points[index] ?? last;
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  points: TrajectoryPoint[],
  upTo: number,
  color: string,
): void {
  ctx.save();
  ctx.globalAlpha = TRAIL_ALPHA;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  let started = false;
  for (const point of points) {
    if (point.t > upTo) break;
    const px = view.toPxX(point.x);
    const py = view.toPxY(point.y);
    if (started) ctx.lineTo(px, py);
    else {
      ctx.moveTo(px, py);
      started = true;
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawScenery(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  family: ExperimentFamily,
  width: number,
): void {
  ctx.save();
  ctx.strokeStyle = GROUND_COLOR;
  ctx.lineWidth = 1.5;
  if (family === "pendulum") {
    // Pivot crosshair + dashed vertical rest line.
    const px = view.toPxX(0);
    const py = view.toPxY(0);
    ctx.beginPath();
    ctx.moveTo(px - 7, py);
    ctx.lineTo(px + 7, py);
    ctx.moveTo(px, py - 7);
    ctx.lineTo(px, py + 7);
    ctx.stroke();
    ctx.setLineDash([4, 6]);
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px, ctx.canvas.clientHeight);
    ctx.stroke();
  } else {
    // Ground line across the full stage.
    const gy = view.toPxY(0);
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(width, gy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBody(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  family: ExperimentFamily,
  point: TrajectoryPoint,
  variant: "base" | "patched",
): void {
  const px = view.toPxX(point.x);
  const py = view.toPxY(point.y);
  ctx.save();
  if (family === "pendulum") {
    // String from the pivot to the bob.
    ctx.strokeStyle =
      variant === "base" ? "rgba(45,212,191,0.6)" : "rgba(251,191,36,0.6)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(view.toPxX(0), view.toPxY(0));
    ctx.lineTo(px, py);
    ctx.stroke();
  }
  if (variant === "base") {
    ctx.fillStyle = BASE_COLOR;
    ctx.beginPath();
    ctx.arc(px, py, 8, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Ring marker: still visible when perfectly overlapping the base body.
    ctx.strokeStyle = PATCHED_COLOR;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(px, py, 11, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function ExperimentCanvas({
  family,
  base,
  patched,
  duration,
  baseLabel,
  patchedLabel,
  freezeAtStart = false,
}: ExperimentCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const trajectories = patched ? [base, patched] : [base];
    const bounds = boundsForTrajectories(family, trajectories);
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const animate = !freezeAtStart && !reducedMotion;

    let frame = 0;
    let disposed = false;
    const start = performance.now();

    const render = (nowMs: number) => {
      if (disposed) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const view = fitBounds(bounds, width, height, 24);
      drawScenery(ctx, view, family, width);

      const loop = duration + HOLD_SECONDS;
      const elapsed = animate
        ? ((nowMs - start) / 1000) % loop
        : freezeAtStart
          ? 0
          : duration; // reduced motion: show the completed paths
      const simTime = Math.min(elapsed, duration);

      drawTrail(ctx, view, base, simTime, BASE_COLOR);
      if (patched) drawTrail(ctx, view, patched, simTime, PATCHED_COLOR);
      drawBody(ctx, view, family, pointAt(base, simTime), "base");
      if (patched) {
        drawBody(ctx, view, family, pointAt(patched, simTime), "patched");
      }

      // Clock readout, top right.
      ctx.save();
      ctx.fillStyle = "rgba(150, 163, 189, 0.9)";
      ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "right";
      ctx.fillText(`t = ${simTime.toFixed(2)} s`, width - 12, 20);
      ctx.restore();

      if (animate) frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);
    const onResize = () => {
      if (!animate) frame = requestAnimationFrame(render);
    };
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [family, base, patched, duration, freezeAtStart]);

  return (
    <div className="stage">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={
          patched && patchedLabel
            ? `Animation comparing ${baseLabel} against the counterfactual: ${patchedLabel}`
            : `Animation of ${baseLabel}`
        }
      />
      <div className="legend">
        <span>
          <span className="key base" aria-hidden />
          {baseLabel}
        </span>
        {patched && patchedLabel ? (
          <span>
            <span className="key patched" aria-hidden />
            {patchedLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}
