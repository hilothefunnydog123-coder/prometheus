/**
 * Minimal in-memory sliding-window rate limiter for the API routes.
 *
 * Deliberately simple for the hackathon deployment shape: a single server
 * process, no external store. Counts live in module memory, so limits reset
 * on redeploy and are per-instance — good enough to keep one browser from
 * burning the provider budget, not a substitute for real abuse protection.
 *
 * Pure and clock-injectable so tests never sleep.
 */

export interface RateLimiterOptions {
  /** Requests allowed per key within each window. */
  limit: number;
  windowMs: number;
  /** Injectable clock (epoch ms); defaults to Date.now. */
  now?: () => number;
  /** Bound on distinct tracked keys; oldest-inserted keys evict first. */
  maxKeys?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Requests left in the current window after this one (0 when denied). */
  remaining: number;
  /** Whole seconds until the client should retry (>= 1 when denied). */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): RateLimitDecision;
}

const DEFAULT_MAX_KEYS = 10_000;

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = options;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`limit must be a positive integer, got ${limit}`);
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new RangeError(`windowMs must be positive, got ${windowMs}`);
  }
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  /** Per-key timestamps of counted requests inside the current window. */
  const hits = new Map<string, number[]>();

  return {
    check(key: string): RateLimitDecision {
      const t = now();
      const cutoff = t - windowMs;
      const recent = (hits.get(key) ?? []).filter((stamp) => stamp > cutoff);

      if (recent.length >= limit) {
        // recent is chronological, so [0] is the next stamp to expire.
        const retryAfterMs = recent[0]! + windowMs - t;
        hits.set(key, recent);
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
        };
      }

      recent.push(t);
      // Re-insert so Map order tracks recency of use, then bound memory by
      // evicting the stalest key.
      hits.delete(key);
      hits.set(key, recent);
      if (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) hits.delete(oldest);
      }
      return {
        allowed: true,
        remaining: limit - recent.length,
        retryAfterSeconds: 0,
      };
    },
  };
}

/** Longest client key we keep; spoofed giant headers must not grow memory. */
const MAX_KEY_LENGTH = 64;

/**
 * Best-effort client identity for rate limiting: first hop of
 * x-forwarded-for, then x-real-ip, then a shared anonymous bucket.
 *
 * The first XFF hop is client-controlled in general; this is only as
 * trustworthy as the proxy in front of the app (fine on the intended
 * single-proxy deployment, and the worst case of spoofing is sharding
 * yourself into fresh buckets — the per-instance memory stays bounded).
 */
export function clientKeyFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const firstHop = forwarded?.split(",")[0]?.trim();
  if (firstHop) return firstHop.slice(0, MAX_KEY_LENGTH).toLowerCase();
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, MAX_KEY_LENGTH).toLowerCase();
  return "anonymous";
}

/**
 * Per-route budgets (requests per minute per client). Compile is stricter:
 * each request can fan out into provider calls; evaluate is cheap.
 * Kept here (not in the route files) so tests can import them — Next.js
 * route modules may only export HTTP handlers and route config.
 */
export const RATE_LIMITS = {
  compile: { limit: 30, windowMs: 60_000 },
  evaluate: { limit: 60, windowMs: 60_000 },
} as const;
