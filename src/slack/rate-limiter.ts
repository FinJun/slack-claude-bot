import { RateLimitError } from '../utils/errors.js';

interface TokenBucketOptions {
  /** Maximum tokens (requests) per window */
  maxTokens: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

/**
 * Token bucket rate limiter.
 * Default: 45 requests per 60 seconds (global Slack rate limit).
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly windowMs: number;

  constructor(options: TokenBucketOptions = { maxTokens: 45, windowMs: 60_000 }) {
    this.maxTokens = options.maxTokens;
    this.windowMs = options.windowMs;
    this.tokens = options.maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * Attempt to consume one token. Throws RateLimitError if no tokens available.
   */
  consume(count = 1): void {
    this.refill();

    if (this.tokens < count) {
      const retryAfterMs = this.msUntilNextToken();
      throw new RateLimitError(retryAfterMs);
    }

    this.tokens -= count;
  }

  /**
   * Returns true if a request can proceed without throwing.
   */
  canConsume(count = 1): boolean {
    this.refill();
    return this.tokens >= count;
  }

  /**
   * Remaining tokens available right now.
   */
  get available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /**
   * Milliseconds until at least one token is available.
   */
  msUntilNextToken(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    const elapsed = Date.now() - this.lastRefill;
    const msPerToken = this.windowMs / this.maxTokens;
    return Math.ceil(msPerToken - (elapsed % msPerToken));
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    if (elapsed >= this.windowMs) {
      // Full refill
      this.tokens = this.maxTokens;
      this.lastRefill = now;
    } else {
      // Partial refill proportional to elapsed time
      const tokensToAdd = (elapsed / this.windowMs) * this.maxTokens;
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }
}

// Global singleton rate limiter (45 req/min)
export const globalRateLimiter = new RateLimiter({ maxTokens: 45, windowMs: 60_000 });
