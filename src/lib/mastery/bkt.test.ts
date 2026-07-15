import { describe, expect, it } from "vitest";
import {
  BKT_DEFAULTS,
  initialMastery,
  isMastered,
  masteryTrajectory,
  predictCorrectness,
  updateMastery,
} from "./bkt";

describe("BKT defaults", () => {
  it("uses the specified parameterization", () => {
    expect(BKT_DEFAULTS).toEqual({
      pInit: 0.25,
      pLearn: 0.15,
      pGuess: 0.2,
      pSlip: 0.1,
    });
    expect(initialMastery()).toBe(0.25);
  });
});

describe("updateMastery", () => {
  // Hand-computed with pInit=.25, pLearn=.15, pGuess=.20, pSlip=.10:
  // correct:   evidence = .25*.9 + .75*.2 = .375; posterior = .225/.375 = .6
  //            p' = .6 + .4*.15 = .66
  // incorrect: evidence = .25*.1 + .75*.8 = .625; posterior = .025/.625 = .04
  //            p' = .04 + .96*.15 = .184
  it("matches the hand-computed posterior after a correct answer", () => {
    expect(updateMastery(0.25, true)).toBeCloseTo(0.66, 10);
  });

  it("matches the hand-computed posterior after an incorrect answer", () => {
    expect(updateMastery(0.25, false)).toBeCloseTo(0.184, 10);
  });

  it("always increases on correct answers and stays in [0, 1]", () => {
    let p = initialMastery();
    for (let i = 0; i < 20; i++) {
      const next = updateMastery(p, true);
      expect(next).toBeGreaterThan(p);
      expect(next).toBeLessThanOrEqual(1);
      p = next;
    }
  });

  it("converges to mastery under repeated correct answers", () => {
    const trajectory = masteryTrajectory(Array(10).fill(true) as boolean[]);
    expect(isMastered(trajectory[trajectory.length - 1]!)).toBe(true);
  });

  it("wrong answers reduce the known-posterior below the prior update", () => {
    expect(updateMastery(0.6, false)).toBeLessThan(updateMastery(0.6, true));
  });

  it("rejects out-of-range pKnown", () => {
    expect(() => updateMastery(-0.1, true)).toThrow(RangeError);
    expect(() => updateMastery(1.1, true)).toThrow(RangeError);
    expect(() => updateMastery(Number.NaN, true)).toThrow(RangeError);
  });

  it("rejects degenerate parameterizations", () => {
    expect(() =>
      updateMastery(0.5, true, {
        pInit: 0.25,
        pLearn: 0.15,
        pGuess: 0.6,
        pSlip: 0.5,
      }),
    ).toThrow(/pGuess \+ pSlip/);
    expect(() =>
      updateMastery(0.5, true, {
        pInit: 0.25,
        pLearn: 1.5,
        pGuess: 0.2,
        pSlip: 0.1,
      }),
    ).toThrow(RangeError);
  });
});

describe("masteryTrajectory", () => {
  it("returns one entry per observation, starting from pInit", () => {
    const trajectory = masteryTrajectory([true, false, true]);
    expect(trajectory).toHaveLength(3);
    expect(trajectory[0]).toBeCloseTo(0.66, 10);
    // Second step applies the incorrect-update to 0.66.
    expect(trajectory[1]).toBeCloseTo(updateMastery(0.66, false), 10);
  });

  it("returns an empty trajectory for no observations", () => {
    expect(masteryTrajectory([])).toEqual([]);
  });
});

describe("predictCorrectness", () => {
  it("mixes slip and guess probabilities", () => {
    // .25*.9 + .75*.2 = .375
    expect(predictCorrectness(0.25)).toBeCloseTo(0.375, 10);
    expect(predictCorrectness(1)).toBeCloseTo(0.9, 10);
    expect(predictCorrectness(0)).toBeCloseTo(0.2, 10);
  });
});

describe("isMastered", () => {
  it("applies the 0.95 default threshold", () => {
    expect(isMastered(0.949)).toBe(false);
    expect(isMastered(0.95)).toBe(true);
  });
});
