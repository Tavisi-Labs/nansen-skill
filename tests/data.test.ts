import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NansenData } from '../src/data.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('NansenData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NANSEN_API_KEY = 'test-api-key';
  });

  describe('constructor', () => {
    it('should throw if no API key provided', () => {
      delete process.env.NANSEN_API_KEY;
      expect(() => new NansenData()).toThrow('NANSEN_API_KEY is required');
    });

    it('should create instance with API key from env', () => {
      const data = new NansenData();
      expect(data).toBeInstanceOf(NansenData);
      expect(data.mcp).toBeDefined();
      expect(data.api).toBeDefined();
    });

    it('should create instance with provided API key', () => {
      delete process.env.NANSEN_API_KEY;
      const data = new NansenData({ apiKey: 'my-key' });
      expect(data).toBeInstanceOf(NansenData);
    });
  });

  describe('getMarketOverview', () => {
    it('should fetch market overview with parallel calls', async () => {
      // Mock MCP screener response
      const screenerResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: JSON.stringify([
            { token_address: '0x123', token_symbol: 'HOT', chain: 'base' },
          ])}],
        },
      };

      // Mock API netflow response
      const netflowResponse = {
        data: [
          { token_address: '0x456', token_symbol: 'FLOW', chain: 'base', net_flow_24h_usd: 100000, trader_count: 10 },
        ],
      };

      // Mock MCP chain rankings response
      const rankingsResponse = {
        jsonrpc: '2.0',
        id: 2,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ rankings: ['ethereum', 'base'] })}],
        },
      };

      // Setup mock to return different responses based on URL
      mockFetch.mockImplementation((url: string, options: any) => {
        const body = JSON.parse(options.body);

        // MCP calls
        if (url.includes('mcp.nansen.ai')) {
          if (body.params?.name === 'token_discovery_screener') {
            return Promise.resolve({
              ok: true,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: () => Promise.resolve(screenerResponse),
            });
          }
          if (body.params?.name === 'growth_chain_rank') {
            return Promise.resolve({
              ok: true,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: () => Promise.resolve(rankingsResponse),
            });
          }
        }

        // API calls
        if (url.includes('api.nansen.ai') && url.includes('netflow')) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve(netflowResponse),
          });
        }

        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ data: [] }),
        });
      });

      const data = new NansenData();
      const overview = await data.getMarketOverview(['base']);

      expect(overview.timestamp).toBeDefined();
      expect(overview.chains).toEqual(['base']);
      expect(overview.hotTokens).toBeDefined();
      expect(overview.smartMoneyActivity).toBeDefined();
      expect(overview.smartMoneyActivity.netflows).toBeDefined();
      expect(overview.smartMoneyActivity.topAccumulating).toBeDefined();
      expect(overview.smartMoneyActivity.topDistributing).toBeDefined();
      expect(overview.errors).toEqual([]);
    });

    it('should use default chains when none provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ data: [], result: { content: [{ type: 'text', text: '[]' }] } }),
      });

      const data = new NansenData();
      const overview = await data.getMarketOverview();

      expect(overview.chains).toEqual(['base', 'ethereum', 'arbitrum', 'polygon']);
    });

    it('should handle partial failures gracefully', async () => {
      // Mock screener to fail, but netflow to succeed
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('mcp.nansen.ai')) {
          return Promise.resolve({
            ok: false,
            status: 500,
            headers: new Headers({ 'content-type': 'text/plain' }),
            text: () => Promise.resolve('Server error'),
          });
        }
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ data: [] }),
        });
      });

      const data = new NansenData();
      const overview = await data.getMarketOverview(['base']);

      // Should still return a result with errors noted
      expect(overview.timestamp).toBeDefined();
      expect(overview.errors.length).toBeGreaterThan(0);
    });

    it('should fetch OHLCV for top tokens when topOhlcvCount > 0', async () => {
      const screenerResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: JSON.stringify([
            { token_address: '0x123', token_symbol: 'HOT', chain: 'base' },
            { token_address: '0x456', token_symbol: 'WARM', chain: 'base' },
          ])}],
        },
      };

      const ohlcvResponse = {
        jsonrpc: '2.0',
        id: 2,
        result: {
          content: [{ type: 'text', text: JSON.stringify({
            candles: [
              { close: 1.0 },
              { close: 1.1 },
              { close: 1.05 },
            ]
          })}],
        },
      };

      mockFetch.mockImplementation((url: string, options: any) => {
        const body = JSON.parse(options.body);

        if (url.includes('mcp.nansen.ai')) {
          if (body.params?.name === 'token_discovery_screener') {
            return Promise.resolve({
              ok: true,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: () => Promise.resolve(screenerResponse),
            });
          }
          if (body.params?.name === 'token_ohlcv') {
            return Promise.resolve({
              ok: true,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: () => Promise.resolve(ohlcvResponse),
            });
          }
          return Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({ result: { content: [{ type: 'text', text: '[]' }] } }),
          });
        }

        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ data: [] }),
        });
      });

      const data = new NansenData();
      const overview = await data.getMarketOverview({
        chains: ['base'],
        topOhlcvCount: 2,
        ohlcvInterval: '1h',
      });

      expect(overview.topTokensOhlcv).toBeDefined();
      expect(overview.topTokensOhlcv!.length).toBeGreaterThan(0);
      expect(overview.topTokensOhlcv![0].interval).toBe('1h');
      expect(overview.topTokensOhlcv![0].volatility).toBeDefined();
    });

    it('should not fetch OHLCV when topOhlcvCount is 0', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ data: [], result: { content: [{ type: 'text', text: '[]' }] } }),
      });

      const data = new NansenData();
      const overview = await data.getMarketOverview({
        chains: ['base'],
        topOhlcvCount: 0,
      });

      expect(overview.topTokensOhlcv).toBeUndefined();
    });

    it('should categorize netflows into accumulating and distributing', async () => {
      const netflowResponse = {
        data: [
          { token_address: '0x1', token_symbol: 'UP', chain: 'base', net_flow_24h_usd: 100000, trader_count: 10 },
          { token_address: '0x2', token_symbol: 'DOWN', chain: 'base', net_flow_24h_usd: -50000, trader_count: 5 },
        ],
      };

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('api.nansen.ai')) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve(netflowResponse),
          });
        }
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ result: { content: [{ type: 'text', text: '[]' }] } }),
        });
      });

      const data = new NansenData();
      const overview = await data.getMarketOverview(['base']);

      expect(overview.smartMoneyActivity.topAccumulating.length).toBe(1);
      expect(overview.smartMoneyActivity.topAccumulating[0].symbol).toBe('UP');
      expect(overview.smartMoneyActivity.topDistributing.length).toBe(1);
      expect(overview.smartMoneyActivity.topDistributing[0].symbol).toBe('DOWN');
    });
  });

  describe('getPolymarketOverview', () => {
    it('should fetch Polymarket-focused data', async () => {
      // Mock search response
      const searchResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ results: ['polymarket'] })}],
        },
      };

      // Mock screener response
      const screenerResponse = {
        jsonrpc: '2.0',
        id: 2,
        result: {
          content: [{ type: 'text', text: JSON.stringify([
            { token_address: '0x123', token_symbol: 'POLY', chain: 'polygon' },
          ])}],
        },
      };

      // Mock netflow response
      const netflowResponse = {
        data: [
          { token_address: '0x456', token_symbol: 'MATIC', chain: 'polygon', net_flow_24h_usd: 50000, trader_count: 5 },
        ],
      };

      mockFetch.mockImplementation((url: string, options: any) => {
        const body = JSON.parse(options.body);

        if (url.includes('mcp.nansen.ai')) {
          if (body.params?.name === 'general_search') {
            return Promise.resolve({
              ok: true,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: () => Promise.resolve(searchResponse),
            });
          }
          if (body.params?.name === 'token_discovery_screener') {
            return Promise.resolve({
              ok: true,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: () => Promise.resolve(screenerResponse),
            });
          }
        }

        if (url.includes('api.nansen.ai')) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve(netflowResponse),
          });
        }

        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ data: [] }),
        });
      });

      const data = new NansenData();
      const overview = await data.getPolymarketOverview();

      expect(overview.timestamp).toBeDefined();
      expect(overview.searchResults).toBeDefined();
      expect(overview.polygonActivity).toBeDefined();
      expect(overview.polygonActivity.hotTokens).toBeDefined();
      expect(overview.polygonActivity.smartMoneyNetflows).toBeDefined();
      expect(overview.knownContracts).toBeDefined();
      expect(overview.knownContracts.ctfExchange).toBe('0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E');
      expect(overview.knownContracts.conditionalTokens).toBe('0x4D97DCd97eC945f40cF65F87097ACe5EA0476045');
      expect(overview.errors).toEqual([]);
    });

    it('should optionally analyze contracts when flag is true', async () => {
      // Mock all responses
      mockFetch.mockImplementation((url: string, options: any) => {
        const body = JSON.parse(options.body);

        if (url.includes('mcp.nansen.ai')) {
          if (body.params?.name === 'token_current_top_holders') {
            return Promise.resolve({
              ok: true,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: () => Promise.resolve({
                result: { content: [{ type: 'text', text: JSON.stringify([{ address: '0xholder' }]) }] },
              }),
            });
          }
          if (body.params?.name === 'token_recent_flows_summary') {
            return Promise.resolve({
              ok: true,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: () => Promise.resolve({
                result: { content: [{ type: 'text', text: JSON.stringify({ flows: [] }) }] },
              }),
            });
          }
          return Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({
              result: { content: [{ type: 'text', text: '[]' }] },
            }),
          });
        }

        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ data: [] }),
        });
      });

      const data = new NansenData();
      const overview = await data.getPolymarketOverview(true);

      expect(overview.contractAnalysis).toBeDefined();
    });

    it('should not analyze contracts when flag is false', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ data: [], result: { content: [{ type: 'text', text: '[]' }] } }),
      });

      const data = new NansenData();
      const overview = await data.getPolymarketOverview(false);

      expect(overview.contractAnalysis).toBeUndefined();
    });
  });

  describe('screenTokens', () => {
    it('should call MCP token_discovery_screener', async () => {
      const screenerResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: JSON.stringify([
            { token_address: '0x123', token_symbol: 'HOT', chain: 'base', price: 1.5 },
          ])}],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(screenerResponse),
      });

      const data = new NansenData();
      const tokens = await data.screenTokens(['base']);

      expect(tokens).toHaveLength(1);
      expect(tokens[0].symbol).toBe('HOT');
      expect(tokens[0].address).toBe('0x123');
    });
  });

  describe('getSmartMoneyNetflow', () => {
    it('should call API and return normalized data', async () => {
      const netflowResponse = {
        data: [
          { token_address: '0x123', token_symbol: 'TEST', chain: 'base', net_flow_24h_usd: 100000, trader_count: 10 },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(netflowResponse),
      });

      const data = new NansenData();
      const result = await data.getSmartMoneyNetflow({ chain: 'base' });

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('TEST');
      expect(result[0].netflowUsd).toBe(100000);
    });
  });

  describe('getTokenHolders', () => {
    it('should prefer MCP when preferMcp is true (default)', async () => {
      const mcpResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: JSON.stringify([
            { address: '0xholder', ownership_percentage: 0.1 },
          ])}],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(mcpResponse),
      });

      const data = new NansenData();
      const result = await data.getTokenHolders('0xtoken', 'base');

      expect(result).toBeDefined();
      // Verify MCP endpoint was called
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('mcp.nansen.ai'),
        expect.any(Object)
      );
    });

    it('should fall back to API on MCP failure', async () => {
      // First call (MCP) fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve('MCP error'),
      });

      // Second call (API) succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({
          data: [{ address: '0xholder', ownership_percentage: 0.1, value_usd: 1000 }],
        }),
      });

      const data = new NansenData();
      const result = await data.getTokenHolders('0xtoken', 'base');

      expect(result).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('search', () => {
    it('should call MCP general_search (free)', async () => {
      const searchResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ results: ['token1', 'token2'] })}],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(searchResponse),
      });

      const data = new NansenData();
      const result = await data.search('AERO');

      expect(result).toBeDefined();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('mcp.nansen.ai'),
        expect.objectContaining({
          body: expect.stringContaining('general_search'),
        })
      );
    });
  });
});
