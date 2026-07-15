import { describe, expect, it } from "vitest";
import type { CompileResponse } from "@/lib/contracts/experiment";
import { dropFixture } from "@/lib/fixtures";
import { CompileCache } from "./compile-cache";

function response(id = "cached-spec"): CompileResponse {
  const spec = structuredClone(dropFixture);
  spec.id = id;
  return {
    spec,
    warnings: [],
    provenance: {
      source: "generated",
      model: "text-model",
      generatedAt: "2026-07-15T00:00:00.000Z",
    },
  };
}

describe("CompileCache", () => {
  it("keys on prompt, gradeBand, and image bytes", () => {
    const base = CompileCache.key("why do things fall", "8-10");
    expect(CompileCache.key("why do things fall", "8-10")).toBe(base);
    expect(CompileCache.key("why do things fall ", "8-10")).toBe(base); // trimmed
    expect(CompileCache.key("why do things fall", "11-12")).not.toBe(base);
    expect(CompileCache.key("why do planets fall", "8-10")).not.toBe(base);
    expect(CompileCache.key("why do things fall", "8-10", "aGVsbG8=")).not.toBe(
      base,
    );
  });

  it("returns deep clones so cached specs cannot be mutated", () => {
    const cache = new CompileCache();
    const key = CompileCache.key("p", "8-10");
    const original = response();
    cache.set(key, original);
    original.spec.title = "mutated after set";

    const first = cache.get(key)!;
    expect(first.spec.title).toBe(dropFixture.title);
    first.spec.title = "mutated after get";
    expect(cache.get(key)!.spec.title).toBe(dropFixture.title);
  });

  it("expires entries after the TTL", () => {
    let clock = 0;
    const cache = new CompileCache({ ttlMs: 1000, now: () => clock });
    const key = CompileCache.key("p", "8-10");
    cache.set(key, response());
    clock = 999;
    expect(cache.get(key)).not.toBeNull();
    clock = 1000;
    expect(cache.get(key)).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("evicts the least recently used entry at capacity", () => {
    const cache = new CompileCache({ capacity: 2 });
    const keyA = CompileCache.key("a", "8-10");
    const keyB = CompileCache.key("b", "8-10");
    const keyC = CompileCache.key("c", "8-10");
    cache.set(keyA, response("a"));
    cache.set(keyB, response("b"));
    cache.get(keyA); // refresh A: B becomes least recently used
    cache.set(keyC, response("c"));
    expect(cache.get(keyA)).not.toBeNull();
    expect(cache.get(keyB)).toBeNull();
    expect(cache.get(keyC)).not.toBeNull();
  });

  it("clear() empties the cache", () => {
    const cache = new CompileCache();
    cache.set(CompileCache.key("p", "8-10"), response());
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
