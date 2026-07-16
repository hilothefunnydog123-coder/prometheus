/** Small display formatters shared by the lab UI. Pure functions. */

/** "2.02 s", "24.1 m", "9.81 m/s^2" — three significant figures. */
export function formatQuantity(value: number, unit: string): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  const digits =
    magnitude === 0 || magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${unit}`;
}

/**
 * Signed percent for counterfactual deltas: "+146%", "−18%", "±0%".
 * `relativeChange` is a ratio (0.5 → "+50%"); null renders as "n/a".
 */
export function formatRelativeChange(relativeChange: number | null): string {
  if (relativeChange === null || !Number.isFinite(relativeChange)) return "n/a";
  const percent = relativeChange * 100;
  if (Math.abs(percent) < 0.05) return "±0%";
  const digits = Math.abs(percent) >= 10 ? 0 : 1;
  const sign = percent > 0 ? "+" : "−";
  return `${sign}${Math.abs(percent).toFixed(digits)}%`;
}

/** Mastery probability as a whole percent: "72%". */
export function formatPercent(probability: number): string {
  return `${Math.round(probability * 100)}%`;
}
