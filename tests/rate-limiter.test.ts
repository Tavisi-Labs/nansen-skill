import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter, RATE_LIMIT_PRESETS } from '../src/rate-limiter.js';

describe('RateLimiter', () => {
  describe('basic operation', () => {
    it('should allow immediate acquisition when tokens available', async () => {
      const limiter = new RateLimiter({ maxTokens: 10, refillRate: 1, minDelayMs: 0 });

      const waitTime = await limiter.acquire();

      expect(waitTime).toBe(0);
    });

    it('should track total requests', async () => {
      const limiter = new RateLimiter({ maxTokens: 10, refillRate: 1, minDelayMs: 0 });

      await limiter.acquire();
      await limiter.acquire();
      await limiter.acquire();

      const stats = limiter.getStats();
      expect(stats.totalRequests).toBe(3);
    });

    it('should report current tokens', () => {
      const limiter = new RateLimiter({ maxTokens: 5, refillRate: 1, minDelayMs: 0 });

      const stats = limiter.getStats();
      expect(stats.currentTokens).toBe(5);
    });
  });

  describe('canAcquire', () => {
    it('should return true when tokens available', () => {
      const limiter = new RateLimiter({ maxTokens: 10, refillRate: 1, minDelayMs: 0 });

      expect(limiter.canAcquire(1)).toBe(true);
      expect(limiter.canAcquire(5)).toBe(true);
      expect(limiter.canAcquire(10)).toBe(true);
    });

    it('should return false when insufficient tokens', () => {
      const limiter = new RateLimiter({ maxTokens: 5, refillRate: 1, minDelayMs: 0 });

      expect(limiter.canAcquire(6)).toBe(false);
      expect(limiter.canAcquire(100)).toBe(false);
    });
  });

  describe('token consumption', () => {
    it('should consume tokens on acquire', async () => {
      const limiter = new RateLimiter({ maxTokens: 10, refillRate: 0, minDelayMs: 0 });

      await limiter.acquire(3);
      expect(limiter.getStats().currentTokens).toBe(7);

      await limiter.acquire(2);
      expect(limiter.getStats().currentTokens).toBe(5);
    });

    it('should support variable cost', async () => {
      const limiter = new RateLimiter({ maxTokens: 10, refillRate: 0, minDelayMs: 0 });

      await limiter.acquire(5); // MCP call costs more
      expect(limiter.getStats().currentTokens).toBe(5);
    });
  });

  describe('token refill', () => {
    it('should refill tokens over time', async () => {
      const limiter = new RateLimiter({ maxTokens: 10, refillRate: 100, minDelayMs: 0 }); // 100/sec

      // Drain tokens
      await limiter.acquire(10);
      expect(limiter.canAcquire(1)).toBe(false);

      // Wait for refill
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have ~5 tokens back
      expect(limiter.canAcquire(1)).toBe(true);
    });

    it('should not exceed max tokens', async () => {
      const limiter = new RateLimiter({ maxTokens: 5, refillRate: 100, minDelayMs: 0 });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(limiter.getStats().currentTokens).toBe(5); // capped at max
    });
  });

  describe('minimum delay', () => {
    it('should enforce minimum delay between requests', async () => {
      const limiter = new RateLimiter({ maxTokens: 100, refillRate: 100, minDelayMs: 50 });

      const start = Date.now();
      await limiter.acquire();
      await limiter.acquire();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow small timing variance
    });
  });

  describe('reset', () => {
    it('should restore full token capacity', async () => {
      const limiter = new RateLimiter({ maxTokens: 10, refillRate: 0, minDelayMs: 0 });

      await limiter.acquire(8);
      expect(limiter.getStats().currentTokens).toBe(2);

      limiter.reset();
      expect(limiter.getStats().currentTokens).toBe(10);
    });
  });
});

describe('RATE_LIMIT_PRESETS', () => {
  it('should have conservative preset', () => {
    expect(RATE_LIMIT_PRESETS.conservative).toEqual({
      maxTokens: 5,
      refillRate: 1,
      minDelayMs: 500,
    });
  });

  it('should have standard preset', () => {
    expect(RATE_LIMIT_PRESETS.standard).toEqual({
      maxTokens: 10,
      refillRate: 2,
      minDelayMs: 200,
    });
  });

  it('should have aggressive preset', () => {
    expect(RATE_LIMIT_PRESETS.aggressive).toEqual({
      maxTokens: 20,
      refillRate: 5,
      minDelayMs: 50,
    });
  });

  it('should have burst preset', () => {
    expect(RATE_LIMIT_PRESETS.burst).toEqual({
      maxTokens: 30,
      refillRate: 3,
      minDelayMs: 100,
    });
  });
});
