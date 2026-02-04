import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Cache, CACHE_TTL } from '../src/cache.js';

describe('Cache', () => {
  let cache: Cache<string>;

  beforeEach(() => {
    cache = new Cache<string>(1000); // 1 second default TTL
  });

  describe('get/set', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for missing keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should return undefined for expired entries', async () => {
      cache.set('key1', 'value1', 50); // 50ms TTL
      expect(cache.get('key1')).toBe('value1');

      await new Promise(resolve => setTimeout(resolve, 60));
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should track hits and misses', () => {
      cache.set('key1', 'value1');
      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('missing'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });
  });

  describe('getOrFetch', () => {
    it('should return cached value without calling fetcher', async () => {
      cache.set('key1', 'cached');
      const fetcher = vi.fn().mockResolvedValue('fetched');

      const result = await cache.getOrFetch('key1', fetcher);

      expect(result).toBe('cached');
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('should call fetcher and cache result when key missing', async () => {
      const fetcher = vi.fn().mockResolvedValue('fetched');

      const result = await cache.getOrFetch('key1', fetcher);

      expect(result).toBe('fetched');
      expect(fetcher).toHaveBeenCalledOnce();
      expect(cache.get('key1')).toBe('fetched');
    });

    it('should track credits saved', async () => {
      cache.set('key1', 'cached');
      await cache.getOrFetch('key1', async () => 'fetched', undefined, 5);

      const stats = cache.getStats();
      expect(stats.creditsSaved).toBe(5);
    });
  });

  describe('invalidate', () => {
    it('should remove specific key', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const removed = cache.invalidate('key1');

      expect(removed).toBe(true);
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBe('value2');
    });

    it('should remove keys matching pattern', () => {
      cache.set('user:1', 'alice');
      cache.set('user:2', 'bob');
      cache.set('token:1', 'xyz');

      const count = cache.invalidatePattern('^user:');

      expect(count).toBe(2);
      expect(cache.get('user:1')).toBeUndefined();
      expect(cache.get('user:2')).toBeUndefined();
      expect(cache.get('token:1')).toBe('xyz');
    });
  });

  describe('prune', () => {
    it('should remove expired entries', async () => {
      cache.set('short', 'value', 50);
      cache.set('long', 'value', 5000);

      await new Promise(resolve => setTimeout(resolve, 60));
      const pruned = cache.prune();

      expect(pruned).toBe(1);
      expect(cache.get('short')).toBeUndefined();
      expect(cache.get('long')).toBe('value');
    });
  });

  describe('makeKey', () => {
    it('should create deterministic keys from params', () => {
      const key1 = Cache.makeKey('prefix', { a: 1, b: 2 });
      const key2 = Cache.makeKey('prefix', { b: 2, a: 1 }); // different order

      expect(key1).toBe(key2); // should be same due to sorting
      expect(key1).toContain('prefix:');
    });
  });
});

describe('CACHE_TTL', () => {
  it('should have expected TTL values', () => {
    expect(CACHE_TTL.SMART_MONEY).toBe(60 * 1000);
    expect(CACHE_TTL.DEX_TRADES).toBe(30 * 1000);
    expect(CACHE_TTL.MCP_ANALYSIS).toBe(10 * 60 * 1000);
  });
});
