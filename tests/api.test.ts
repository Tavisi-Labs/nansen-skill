import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NansenClient, NansenApiError } from '../src/api.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('NansenClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NANSEN_API_KEY = 'test-api-key';
  });

  describe('constructor', () => {
    it('should throw if no API key provided', () => {
      delete process.env.NANSEN_API_KEY;
      expect(() => new NansenClient()).toThrow('NANSEN_API_KEY is required');
    });

    it('should create client with API key from env', () => {
      const client = new NansenClient();
      expect(client).toBeInstanceOf(NansenClient);
    });

    it('should create client with provided API key', () => {
      delete process.env.NANSEN_API_KEY;
      const client = new NansenClient('my-key');
      expect(client).toBeInstanceOf(NansenClient);
    });
  });

  describe('getSmartMoneyNetflow', () => {
    it('should fetch smart money data', async () => {
      const mockData = {
        data: [
          {
            token: '0x123',
            symbol: 'TEST',
            name: 'Test Token',
            chain: 'ethereum',
            netflow: 1000,
            netflowUsd: 50000,
            inflow: 2000,
            inflowUsd: 100000,
            outflow: 1000,
            outflowUsd: 50000,
            buyersCount: 10,
            sellersCount: 5,
            timestamp: '2024-01-01T00:00:00Z',
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const client = new NansenClient();
      const result = await client.getSmartMoneyNetflow({ chain: 'ethereum' });

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('TEST');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.nansen.ai/api/v1/smart-money/netflow',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            apiKey: 'test-api-key',
          }),
        })
      );
    });

    it('should filter by direction', async () => {
      const mockData = {
        data: [
          { token: '0x1', netflow: 100, netflowUsd: 5000 },
          { token: '0x2', netflow: -50, netflowUsd: -2500 },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const client = new NansenClient();
      const result = await client.getSmartMoneyNetflow({
        chain: 'ethereum',
        direction: 'inflow',
      });

      expect(result).toHaveLength(1);
      expect(result[0].netflow).toBeGreaterThan(0);
    });

    it('should filter by minimum value', async () => {
      const mockData = {
        data: [
          { token: '0x1', netflowUsd: 100000 },
          { token: '0x2', netflowUsd: 5000 },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const client = new NansenClient();
      const result = await client.getSmartMoneyNetflow({
        chain: 'ethereum',
        minValue: 50000,
      });

      expect(result).toHaveLength(1);
      expect(result[0].netflowUsd).toBe(100000);
    });
  });

  describe('screenTokens', () => {
    it('should screen tokens with filters', async () => {
      const mockData = {
        data: [
          {
            token: '0x123',
            symbol: 'TEST',
            marketCap: 1000000,
            smartMoneyNetflow: 50000,
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const client = new NansenClient();
      const result = await client.screenTokens({
        chain: 'base',
        onlySmartMoney: true,
        minMcap: 100000,
      });

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('TEST');
    });
  });

  describe('error handling', () => {
    it('should throw NansenApiError on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({
          code: 'UNAUTHORIZED',
          message: 'Invalid API key',
        }),
      });

      const client = new NansenClient();

      await expect(client.getSmartMoneyNetflow({ chain: 'ethereum' }))
        .rejects.toThrow(NansenApiError);
    });

    it('should handle non-JSON error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      const client = new NansenClient();

      await expect(client.getSmartMoneyNetflow({ chain: 'ethereum' }))
        .rejects.toThrow(NansenApiError);
    });
  });

  describe('scanOpportunities', () => {
    it('should scan for accumulation signals', async () => {
      const mockData = {
        data: [
          {
            token: '0x123',
            symbol: 'ALPHA',
            netflow: 50000,
            netflowUsd: 100000,
            buyersCount: 15,
            sellersCount: 3,
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const client = new NansenClient();
      const result = await client.scanOpportunities({
        chain: 'ethereum',
        mode: 'accumulation',
      });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('accumulation');
      expect(result[0].score).toBeGreaterThan(0);
    });
  });
});
