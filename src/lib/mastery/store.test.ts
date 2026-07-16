import { describe, expect, it } from "vitest";
import { BKT_DEFAULTS, initialMastery, updateMastery } from "./bkt";
import {
  MASTERY_STORE_VERSION,
  deserializeMasteryRecord,
  emptyMasteryRecord,
  getMastery,
  masteredConcepts,
  recordObservation,
  serializeMasteryRecord,
  weakestConcepts,
} from "./store";

describe("recordObservation", () => {
  it("initializes an unseen concept at P(L0) before updating", () => {
    const record = recordObservation(emptyMasteryRecord(), ["free-fall"], true);
    const expected = updateMastery(initialMastery(), true);
    expect(record.concepts["free-fall"]!.pKnown).toBeCloseTo(expected, 12);
    expect(record.concepts["free-fall"]!.attempts).toBe(1);
    expect(record.concepts["free-fall"]!.correct).toBe(1);
  });

  it("updates every concept the experiment exercises", () => {
    const record = recordObservation(
      emptyMasteryRecord(),
      ["free-fall", "acceleration"],
      false,
    );
    expect(Object.keys(record.concepts).sort()).toEqual([
      "acceleration",
      "free-fall",
    ]);
    expect(record.concepts["free-fall"]!.correct).toBe(0);
  });

  it("never mutates the input record", () => {
    const before = recordObservation(emptyMasteryRecord(), ["free-fall"], true);
    const snapshot = JSON.parse(JSON.stringify(before));
    recordObservation(before, ["free-fall", "acceleration"], false);
    expect(before).toEqual(snapshot);
  });

  it("accumulates attempts and correct counts across observations", () => {
    let record = emptyMasteryRecord();
    for (const answer of [true, false, true]) {
      record = recordObservation(record, ["oscillation"], answer);
    }
    expect(record.concepts["oscillation"]!.attempts).toBe(3);
    expect(record.concepts["oscillation"]!.correct).toBe(2);
  });

  it("mastery rises toward 1 under repeated correct answers", () => {
    let record = emptyMasteryRecord();
    let previous = initialMastery();
    for (let i = 0; i < 8; i += 1) {
      record = recordObservation(record, ["free-fall"], true);
      const current = record.concepts["free-fall"]!.pKnown;
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
    expect(previous).toBeGreaterThan(0.99);
  });

  it("stamps and preserves updatedAtMs when the caller provides one", () => {
    let record = recordObservation(emptyMasteryRecord(), ["free-fall"], true, {
      nowMs: 1000,
    });
    expect(record.concepts["free-fall"]!.updatedAtMs).toBe(1000);
    // A later observation without a timestamp keeps the previous stamp.
    record = recordObservation(record, ["free-fall"], true);
    expect(record.concepts["free-fall"]!.updatedAtMs).toBe(1000);
  });

  it("throws on a malformed concept id", () => {
    expect(() =>
      recordObservation(emptyMasteryRecord(), ["Not A Slug!"], true),
    ).toThrow(RangeError);
  });
});

describe("getMastery", () => {
  it("returns P(L0) for unseen concepts", () => {
    expect(getMastery(emptyMasteryRecord(), "free-fall")).toBe(
      BKT_DEFAULTS.pInit,
    );
  });

  it("returns the stored value for seen concepts", () => {
    const record = recordObservation(emptyMasteryRecord(), ["free-fall"], true);
    expect(getMastery(record, "free-fall")).toBe(
      record.concepts["free-fall"]!.pKnown,
    );
  });
});

describe("weakestConcepts / masteredConcepts", () => {
  it("orders by ascending mastery with alphabetical tie-break", () => {
    let record = emptyMasteryRecord();
    record = recordObservation(record, ["strong"], true);
    record = recordObservation(record, ["strong"], true);
    record = recordObservation(record, ["weak-b", "weak-a"], false);
    expect(weakestConcepts(record, 2)).toEqual(["weak-a", "weak-b"]);
    expect(weakestConcepts(record, 10)).toEqual(["weak-a", "weak-b", "strong"]);
    expect(weakestConcepts(record, 0)).toEqual([]);
  });

  it("reports concepts at or above the threshold as mastered", () => {
    let record = emptyMasteryRecord();
    for (let i = 0; i < 10; i += 1) {
      record = recordObservation(record, ["free-fall"], true);
    }
    record = recordObservation(record, ["oscillation"], false);
    expect(masteredConcepts(record)).toEqual(["free-fall"]);
  });
});

describe("serialization", () => {
  it("round-trips through serialize/deserialize", () => {
    let record = emptyMasteryRecord();
    record = recordObservation(record, ["free-fall", "acceleration"], true, {
      nowMs: 42,
    });
    record = recordObservation(record, ["free-fall"], false);
    const restored = deserializeMasteryRecord(serializeMasteryRecord(record));
    expect(restored).toEqual(record);
  });

  it("degrades to an empty record on malformed payloads", () => {
    const empty = emptyMasteryRecord();
    expect(deserializeMasteryRecord(null)).toEqual(empty);
    expect(deserializeMasteryRecord(undefined)).toEqual(empty);
    expect(deserializeMasteryRecord("")).toEqual(empty);
    expect(deserializeMasteryRecord("not json{")).toEqual(empty);
    expect(deserializeMasteryRecord('"a string"')).toEqual(empty);
    expect(deserializeMasteryRecord('{"version":999,"concepts":{}}')).toEqual(
      empty,
    );
  });

  it("rejects corrupt concept states instead of importing them", () => {
    const corrupt = JSON.stringify({
      version: MASTERY_STORE_VERSION,
      concepts: {
        "free-fall": { pKnown: 2, attempts: 1, correct: 1 },
      },
    });
    expect(deserializeMasteryRecord(corrupt)).toEqual(emptyMasteryRecord());
    const inconsistent = JSON.stringify({
      version: MASTERY_STORE_VERSION,
      concepts: {
        "free-fall": { pKnown: 0.5, attempts: 1, correct: 5 },
      },
    });
    expect(deserializeMasteryRecord(inconsistent)).toEqual(
      emptyMasteryRecord(),
    );
  });
});
