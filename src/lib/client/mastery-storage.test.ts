import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  masteryProbability,
  recordMasteryObservation,
} from "./mastery-storage";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  clear(): void {
    this.values.clear();
  }
}

const localStorage = new MemoryStorage();

describe("local mastery profile", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("window", { localStorage });
  });

  it("starts at the documented BKT prior", () => {
    expect(masteryProbability("mass-fall-speed")).toBe(0.25);
  });

  it("persists objective prediction observations", () => {
    const afterCorrect = recordMasteryObservation("mass-fall-speed", true);
    expect(afterCorrect).toBeGreaterThan(0.25);
    expect(masteryProbability("mass-fall-speed")).toBe(afterCorrect);

    const afterIncorrect = recordMasteryObservation(
      "mass-fall-speed",
      false,
    );
    expect(afterIncorrect).toBeLessThan(afterCorrect);
  });
});
