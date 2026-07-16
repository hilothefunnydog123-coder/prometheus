import { describe, expect, it } from "vitest";
import {
  formatPercent,
  formatQuantity,
  formatRelativeChange,
} from "./format";

describe("formatQuantity", () => {
  it("scales decimal places with magnitude", () => {
    expect(formatQuantity(2.0192, "s")).toBe("2.02 s");
    expect(formatQuantity(24.13, "m")).toBe("24.1 m");
    expect(formatQuantity(146.7, "m")).toBe("147 m");
    expect(formatQuantity(0, "m")).toBe("0 m");
  });

  it("degrades gracefully for non-finite values", () => {
    expect(formatQuantity(Number.NaN, "s")).toBe("—");
    expect(formatQuantity(Number.POSITIVE_INFINITY, "s")).toBe("—");
  });
});

describe("formatRelativeChange", () => {
  it("formats signed percentages", () => {
    expect(formatRelativeChange(1.46)).toBe("+146%");
    expect(formatRelativeChange(-0.18)).toBe("−18%");
    expect(formatRelativeChange(0.055)).toBe("+5.5%");
  });

  it("collapses numerical noise to ±0%", () => {
    expect(formatRelativeChange(0)).toBe("±0%");
    expect(formatRelativeChange(1e-12)).toBe("±0%");
  });

  it("reports n/a when a ratio is meaningless", () => {
    expect(formatRelativeChange(null)).toBe("n/a");
  });
});

describe("formatPercent", () => {
  it("rounds probabilities to whole percents", () => {
    expect(formatPercent(0.25)).toBe("25%");
    expect(formatPercent(0.999)).toBe("100%");
  });
});
