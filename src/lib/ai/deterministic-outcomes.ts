/**
 * The compiler and renderer share one deterministic physics implementation.
 * AI-authored content may choose bounded inputs, but it never owns the
 * expected outcome shown to learners.
 */
export * from "@/lib/physics/deterministic-outcomes";
