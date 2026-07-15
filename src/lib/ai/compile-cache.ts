import { createHash } from "node:crypto";
import type { CompileResponse, GradeBand } from "@/lib/contracts/experiment";

/**
 * Per-instance TTL/LRU cache for successful generated compiler responses.
 * Validated-example fallbacks are deliberately never cached so recovery of
 * the provider immediately restores fresh generation.
 */
interface CacheEntry {
  value: CompileResponse;
  expiresAt: number;
}

export interface CompileCacheOptions {
  capacity?: number;
  ttlMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

const DEFAULT_CAPACITY = 50;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class CompileCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly capacity: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: CompileCacheOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  static key(
    prompt: string,
    gradeBand: GradeBand,
    imageBase64?: string,
  ): string {
    return createHash("sha256")
      .update(gradeBand)
      .update("\0")
      .update(prompt.trim())
      .update("\0")
      .update(imageBase64 ?? "")
      .digest("hex");
  }

  get(key: string): CompileResponse | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return structuredClone(entry.value);
  }

  set(key: string, value: CompileResponse): void {
    this.entries.delete(key);
    this.entries.set(key, {
      value: structuredClone(value),
      expiresAt: this.now() + this.ttlMs,
    });
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

export const compileCache = new CompileCache();
