import { describe, expect, it } from "vitest";
import type { CompileResponse } from "@/lib/contracts/experiment";
import { dropDemo } from "@/components/lab/demo-experiments";
import { CompileCache } from "./compile-cache";

function response(id = "cached-spec"): CompileResponse {
  const spec = structuredClone(dropDemo);
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
  it("keys on normalized prompt, grade band, and image bytes", () => {
    const base = CompileCache.key("why do things fall", "8-10");
    expect(CompileCache.key("why do things fall ", "8-10")).toBe(base);
    expect(CompileCache.key("why do things fall", "11-12")).not.toBe(base);
    expect(CompileCache.key("why do planets fall", "8-10")).not.toBe(base);
    expect(CompileCache.key("why do things fall", "8-10", "aGVsbG8=")).not.toBe(
      base,
    );
  });

  it("deep-clones values on set and get", () => {
    const cache = new CompileCache();
    const key = CompileCache.key("p", "8-10");
    const original = response();
    cache.set(key, original);
    original.spec.title = "mutated after set";

    const first = cache.get(key)!;
    expect(first.spec.title).toBe(dropDemo.title);
    first.spec.title = "mutated after get";
    expect(cache.get(key)!.spec.title).toBe(dropDemo.title);
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
    cache.get(keyA);
    cache.set(keyC, response("c"));
    expect(cache.get(keyA)).not.toBeNull();
    expect(cache.get(keyB)).toBeNull();
    expect(cache.get(keyC)).not.toBeNull();
  });

  it("clears all entries", () => {
    const cache = new CompileCache();
    cache.set(CompileCache.key("p", "8-10"), response());
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
