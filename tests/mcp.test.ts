import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NansenMcp, NansenMcpError } from '../src/mcp.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('NansenMcp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with API key', () => {
      const mcp = new NansenMcp('test-key');
      expect(mcp).toBeInstanceOf(NansenMcp);
    });

    it('should accept custom endpoint', () => {
      const mcp = new NansenMcp('test-key', 'https://custom.endpoint/mcp');
      expect(mcp).toBeInstanceOf(NansenMcp);
    });
  });

  describe('callTool - JSON response', () => {
    it('should parse JSON response correctly', async () => {
      const jsonResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ data: 'test' }) }],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(jsonResponse),
      });

      const mcp = new NansenMcp('test-key');
      const result = await mcp.callTool('general_search', { query: 'test' });

      expect(result).toEqual({ data: 'test' });
    });

    it('should handle JSON-RPC error response', async () => {
      const errorResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Invalid request' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(errorResponse),
      });

      const mcp = new NansenMcp('test-key');
      await expect(mcp.callTool('general_search', { query: 'test' }))
        .rejects.toThrow(NansenMcpError);
    });
  });

  describe('callTool - SSE response', () => {
    it('should parse SSE text/event-stream response correctly', async () => {
      const sseText = `event: message
data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\\"found\\":true}"}]}}

`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        text: () => Promise.resolve(sseText),
      });

      const mcp = new NansenMcp('test-key');
      const result = await mcp.callTool('general_search', { query: 'test' });

      expect(result).toEqual({ found: true });
    });

    it('should handle multi-line SSE with multiple data events', async () => {
      const sseText = `event: message
data: {"jsonrpc":"2.0","id":1,"method":"progress","params":{"status":"loading"}}

event: message
data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\\"final\\":true}"}]}}

`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        text: () => Promise.resolve(sseText),
      });

      const mcp = new NansenMcp('test-key');
      const result = await mcp.callTool('general_search', { query: 'test' });

      // Should return the last valid JSON-RPC response with a result
      expect(result).toEqual({ final: true });
    });

    it('should handle SSE with error in response', async () => {
      const sseText = `event: message
data: {"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"Tool error"}}

`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        text: () => Promise.resolve(sseText),
      });

      const mcp = new NansenMcp('test-key');
      await expect(mcp.callTool('general_search', { query: 'test' }))
        .rejects.toThrow(NansenMcpError);
    });

    it('should throw on empty SSE response', async () => {
      const sseText = `event: ping

`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        text: () => Promise.resolve(sseText),
      });

      const mcp = new NansenMcp('test-key');
      await expect(mcp.callTool('general_search', { query: 'test' }))
        .rejects.toThrow('No data in SSE response');
    });

    it('should throw on SSE with no valid JSON-RPC', async () => {
      const sseText = `event: message
data: not valid json

event: message
data: {"notJsonRpc": true}

`;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        text: () => Promise.resolve(sseText),
      });

      const mcp = new NansenMcp('test-key');
      await expect(mcp.callTool('general_search', { query: 'test' }))
        .rejects.toThrow('No valid JSON-RPC response in SSE');
    });
  });

  describe('callTool - HTTP errors', () => {
    it('should throw NansenMcpError on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Invalid API key'),
      });

      const mcp = new NansenMcp('test-key');
      await expect(mcp.callTool('general_search', { query: 'test' }))
        .rejects.toThrow('MCP HTTP error: 401 Unauthorized');
    });

    it('should throw on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const mcp = new NansenMcp('test-key');
      await expect(mcp.callTool('general_search', { query: 'test' }))
        .rejects.toThrow('MCP request failed: Network failure');
    });
  });

  describe('helper methods', () => {
    it('search should call general_search tool', async () => {
      const jsonResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ results: [] }) }],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(jsonResponse),
      });

      const mcp = new NansenMcp('test-key');
      await mcp.search('AERO');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('general_search'),
        })
      );
    });

    it('getToolCredits should return credits for known tools', () => {
      const mcp = new NansenMcp('test-key');
      expect(mcp.getToolCredits('general_search')).toBe(0); // Free
      expect(mcp.getToolCredits('token_current_top_holders')).toBe(5);
      expect(mcp.getToolCredits('token_dex_trades')).toBe(1);
    });

    it('listTools should return all available tools', () => {
      const mcp = new NansenMcp('test-key');
      const tools = mcp.listTools();

      expect(tools.length).toBeGreaterThanOrEqual(21);
      expect(tools.find(t => t.name === 'general_search')).toBeDefined();
      expect(tools.find(t => t.name === 'token_discovery_screener')).toBeDefined();
      // Verify each tool has required properties
      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(typeof tool.credits).toBe('number');
      }
    });
  });
});
