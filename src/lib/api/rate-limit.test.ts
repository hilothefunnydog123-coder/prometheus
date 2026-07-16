import { describe, expect, it } from "vitest";
import {
  RATE_LIMITS,
  clientKeyFromRequest,
  createRateLimiter,
} from "./rate-limit";

/** Manual clock so tests never sleep. */
function fakeClock(startMs = 0) {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("createRateLimiter", () => {
  it("allows exactly `limit` requests per window, then denies", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({
      limit: 3,
      windowMs: 60_000,
      now: clock.now,
    });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    const third = limiter.check("a");
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = limiter.check("a");
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("slides the window instead of resetting it", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({
      limit: 2,
      windowMs: 60_000,
      now: clock.now,
    });
    limiter.check("a"); // t = 0
    clock.advance(40_000);
    limiter.check("a"); // t = 40s
    clock.advance(10_000); // t = 50s: both still inside the window
    expect(limiter.check("a").allowed).toBe(false);
    clock.advance(15_000); // t = 65s: the t=0 hit has expired
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("reports how long to wait until the oldest hit expires", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      now: clock.now,
    });
    limiter.check("a"); // t = 0
    clock.advance(20_000);
    const denied = limiter.check("a");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(40);
  });

  it("tracks keys independently", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      now: clock.now,
    });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("b").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("evicts the stalest key once maxKeys is exceeded", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      now: clock.now,
      maxKeys: 2,
    });
    limiter.check("a");
    limiter.check("b");
    limiter.check("c"); // evicts "a"
    // "a" was forgotten, so it gets a fresh budget instead of a denial.
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("rejects nonsensical configuration loudly", () => {
    expect(() => createRateLimiter({ limit: 0, windowMs: 1000 })).toThrow(
      RangeError,
    );
    expect(() => createRateLimiter({ limit: 1.5, windowMs: 1000 })).toThrow(
      RangeError,
    );
    expect(() => createRateLimiter({ limit: 5, windowMs: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("clientKeyFromRequest", () => {
  const requestWith = (headers: Record<string, string>) =>
    new Request("http://test.local/", { headers });

  it("uses the first x-forwarded-for hop, normalized", () => {
    expect(
      clientKeyFromRequest(
        requestWith({ "x-forwarded-for": " 203.0.113.9 , 10.0.0.1" }),
      ),
    ).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip, then to a shared anonymous bucket", () => {
    expect(
      clientKeyFromRequest(requestWith({ "x-real-ip": "198.51.100.7" })),
    ).toBe("198.51.100.7");
    expect(clientKeyFromRequest(requestWith({}))).toBe("anonymous");
  });

  it("caps the key length so giant spoofed headers cannot grow memory", () => {
    const key = clientKeyFromRequest(
      requestWith({ "x-forwarded-for": "x".repeat(4096) }),
    );
    expect(key.length).toBeLessThanOrEqual(64);
  });
});

describe("RATE_LIMITS", () => {
  it("keeps compile stricter than evaluate", () => {
    expect(RATE_LIMITS.compile.limit).toBeLessThan(RATE_LIMITS.evaluate.limit);
  });
});
