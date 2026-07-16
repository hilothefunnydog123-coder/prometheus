"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ExperimentSpec } from "@/lib/contracts/experiment";
import {
  isVelocityFocusedDrop,
  type SimulationEvidence,
} from "@/lib/physics/evidence";

export function EvidenceChart({ spec, evidence }: { spec: ExperimentSpec; evidence: SimulationEvidence }) {
  const velocityFocusedDrop = isVelocityFocusedDrop(spec);
  const sandbox = spec.scene.family === "sandbox";
  const labels = sandbox
    ? [
        spec.measurements[0]?.label ?? "Series A",
        spec.measurements[1]?.label ?? "Series B",
      ]
    : spec.scene.family === "drop"
      ? velocityFocusedDrop
        ? ["Object A speed", "Object B speed"]
        : ["Object A height", "Object B height"]
      : spec.scene.family === "projectile"
        ? ["Horizontal position", "Height"]
        : ["Angle", "Speed"];
  const units = sandbox
    ? [spec.measurements[0]?.unit ?? "m", spec.measurements[1]?.unit ?? "m"]
    : spec.scene.family === "drop"
      ? velocityFocusedDrop
        ? ["m/s", "m/s"]
        : ["m", "m"]
      : spec.scene.family === "projectile"
        ? ["m", "m"]
        : ["°", "m/s"];
  return (
    <div className="chart-wrap" aria-label={`Evidence chart showing ${labels.join(" and ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={evidence.points} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid stroke="#20303c" strokeDasharray="2 6" vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickCount={7}
            tickFormatter={(value) => Number(value).toFixed(1)}
            stroke="#5f7380"
            tick={{ fill: "#7f929e", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis stroke="#5f7380" tick={{ fill: "#7f929e", fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "#0a111b", border: "1px solid #263846", borderRadius: 10, color: "#eaf6fb", fontSize: 11 }}
            labelFormatter={(value) => `${Number(value).toFixed(2)} s`}
            formatter={(value, name) => {
              const index = labels.indexOf(String(name));
              return [
                `${Number(value).toFixed(2)} ${units[index] ?? ""}`.trim(),
                String(name),
              ];
            }}
          />
          <Line type="monotone" dataKey={velocityFocusedDrop ? "primaryVelocity" : "primary"} name={labels[0]} stroke="#ff8a3d" strokeWidth={2.5} dot={false} animationDuration={500} />
          <Line type="monotone" dataKey={velocityFocusedDrop ? "secondaryVelocity" : "secondary"} name={labels[1]} stroke="#5de1ff" strokeWidth={2.5} dot={false} animationDuration={650} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
