/**
 * Nansen MCP Client
 * Direct HTTP client for Nansen MCP (no subprocess)
 *
 * MCP Endpoint: https://mcp.nansen.ai/ra/mcp
 * Docs: https://docs.nansen.ai/mcp/overview
 */

import type { Chain } from './types.js';

const MCP_ENDPOINT = 'https://mcp.nansen.ai/ra/mcp';
const MCP_TIMEOUT_MS = 30000;

export class NansenMcpError extends Error {
  constructor(message: string, public code?: string, public details?: unknown) {
    super(message);
    this.name = 'NansenMcpError';
  }
}

export type McpTool =
  // Smart Money
  | 'smart_traders_and_funds_token_balances'
  | 'smart_traders_and_funds_netflows'
  | 'smart_traders_and_funds_dcas_solana'
  // Token God Mode
  | 'token_current_top_holders'
  | 'token_dex_trades'
  | 'token_transfers'
  | 'token_flows'
  | 'token_pnl_leaderboard'
  | 'token_who_bought_sold'
  | 'token_jup_dca'
  | 'token_recent_flows_summary'
  | 'token_discovery_screener'
  | 'token_ohlcv'
  // Wallet Profiler
  | 'address_historical_balances'
  | 'address_related_addresses'
  | 'address_counterparties'
  | 'address_transactions'
  | 'wallet_pnl_for_token'
  | 'wallet_pnl_summary'
  | 'address_transactions_for_token'
  | 'address_portfolio'
  // Misc
  | 'general_search'
  | 'growth_chain_rank'
  | 'transaction_lookup';

export const MCP_TOOLS: Record<McpTool, { description: string; credits: number }> = {
  smart_traders_and_funds_token_balances: { description: 'Aggregated smart trader/fund balances per chain', credits: 5 },
  smart_traders_and_funds_netflows: { description: 'Net flows over 1/7/30 days', credits: 5 },
  smart_traders_and_funds_dcas_solana: { description: 'Jupiter DCA orders on Solana', credits: 5 },
  token_current_top_holders: { description: 'Top 25 holders for a token', credits: 5 },
  token_dex_trades: { description: 'DEX trades with smart money filter', credits: 1 },
  token_transfers: { description: 'Token transfers (25 per page)', credits: 1 },
  token_flows: { description: 'Hourly flows by segment', credits: 1 },
  token_pnl_leaderboard: { description: 'Trader PnL rankings', credits: 5 },
  token_who_bought_sold: { description: 'Buy/sell amounts by address', credits: 1 },
  token_jup_dca: { description: 'Jupiter DCA for Solana tokens', credits: 1 },
  token_recent_flows_summary: { description: 'Flow summary per segment', credits: 1 },
  token_discovery_screener: { description: 'Multi-chain screener', credits: 1 },
  token_ohlcv: { description: 'Price data with intervals', credits: 1 },
  address_historical_balances: { description: 'Historical balances', credits: 1 },
  address_related_addresses: { description: 'Funders, signers, contracts', credits: 1 },
  address_counterparties: { description: 'Top 25 counterparties', credits: 5 },
  address_transactions: { description: 'Recent transactions (20 per page)', credits: 1 },
  wallet_pnl_for_token: { description: 'PnL for specific tokens', credits: 1 },
  wallet_pnl_summary: { description: 'Aggregate realized PnL', credits: 1 },
  address_transactions_for_token: { description: 'Token transfer history', credits: 1 },
  address_portfolio: { description: 'Full portfolio + DeFi positions', credits: 1 },
  general_search: { description: 'Search tokens/entities/addresses', credits: 0 },
  growth_chain_rank: { description: 'Chain activity rankings', credits: 1 },
  transaction_lookup: { description: 'Transaction details (EVM)', credits: 1 },
};

interface McpToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

interface McpJsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: McpToolResult;
  error?: { code: number; message: string; data?: unknown };
}

export class NansenMcp {
  private apiKey: string;
  private mcpEndpoint: string;

  constructor(apiKey: string, mcpEndpoint?: string) {
    this.apiKey = apiKey;
    this.mcpEndpoint = mcpEndpoint || MCP_ENDPOINT;
  }

  /**
   * Call an MCP tool via HTTP JSON-RPC
   * Handles both JSON and SSE (text/event-stream) responses
   */
  async callTool<T = unknown>(tool: McpTool, params: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);

    try {
      const response = await fetch(this.mcpEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'NANSEN-API-KEY': this.apiKey,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: { name: tool, arguments: params },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new NansenMcpError(
          `MCP HTTP error: ${response.status} ${response.statusText}`,
          `HTTP_${response.status}`,
          { body: text }
        );
      }

      // Handle SSE vs JSON response based on Content-Type
      const contentType = response.headers.get('content-type') || '';
      let data: McpJsonRpcResponse;

      if (contentType.includes('text/event-stream')) {
        data = await this.parseSseResponse(response);
      } else {
        data = await response.json();
      }

      if (data.error) {
        throw new NansenMcpError(
          data.error.message,
          `MCP_${data.error.code}`,
          data.error.data
        );
      }

      return this.parseToolResult<T>(data.result);
    } catch (error: unknown) {
      if (error instanceof NansenMcpError) throw error;
      if ((error as Error).name === 'AbortError') {
        throw new NansenMcpError('MCP request timed out', 'TIMEOUT');
      }
      throw new NansenMcpError(
        `MCP request failed: ${(error as Error).message}`,
        'FETCH_ERROR',
        error
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Parse Server-Sent Events (SSE) response format
   * SSE format: "event: message\ndata: {json}\n\n"
   */
  private async parseSseResponse(response: Response): Promise<McpJsonRpcResponse> {
    const text = await response.text();

    // Extract all "data:" lines and parse the last complete JSON-RPC response
    const dataLines: string[] = [];
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        dataLines.push(line.slice(6)); // Remove "data: " prefix
      }
    }

    if (dataLines.length === 0) {
      throw new NansenMcpError('No data in SSE response', 'SSE_PARSE_ERROR', { raw: text });
    }

    // Try to parse each data line as JSON, looking for the final result
    let lastValidResponse: McpJsonRpcResponse | null = null;
    for (const dataLine of dataLines) {
      try {
        const parsed = JSON.parse(dataLine);
        if (parsed.jsonrpc === '2.0') {
          lastValidResponse = parsed;
        }
      } catch {
        // Skip non-JSON lines
      }
    }

    if (!lastValidResponse) {
      throw new NansenMcpError('No valid JSON-RPC response in SSE', 'SSE_PARSE_ERROR', { dataLines });
    }

    return lastValidResponse;
  }

  /**
   * Parse MCP tool result - handles both JSON and text responses
   */
  private parseToolResult<T>(result?: McpToolResult): T {
    if (!result) {
      return null as T;
    }

    if (result.isError) {
      const errorText = result.content?.find(c => c.type === 'text')?.text || 'Unknown MCP error';
      throw new NansenMcpError(errorText, 'TOOL_ERROR');
    }

    // Extract text content
    const textContent = result.content?.find(c => c.type === 'text')?.text;
    if (!textContent) {
      return null as T;
    }

    // Try to parse as JSON first
    try {
      return JSON.parse(textContent) as T;
    } catch {
      // Return as string if not JSON
      return textContent as T;
    }
  }

  // ===========================================================================
  // Smart Money Tools
  // ===========================================================================

  async getSmartTraderBalances(chain: Chain) {
    return this.callTool('smart_traders_and_funds_token_balances', { chains: [chain] });
  }

  async getSmartTraderNetflows(chain: Chain) {
    return this.callTool('smart_traders_and_funds_netflows', { chains: [chain] });
  }

  async getSolanaDcaOrders(token?: string) {
    return this.callTool('smart_traders_and_funds_dcas_solana', token ? { token } : {});
  }

  // ===========================================================================
  // Token Analysis Tools
  // ===========================================================================

  async getTokenHolders(token: string, chain: Chain, limit = 25) {
    return this.callTool('token_current_top_holders', { token, chain, limit });
  }

  async getTokenDexTrades(token: string, chain: Chain, onlySmartMoney = false) {
    return this.callTool('token_dex_trades', { token, chain, only_smart_money: onlySmartMoney });
  }

  async getTokenFlows(token: string, chain: Chain, startDate?: string, endDate?: string) {
    const params: Record<string, unknown> = { token, chain };
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    return this.callTool('token_flows', params);
  }

  async getTokenPnlLeaderboard(token: string, chain: Chain) {
    return this.callTool('token_pnl_leaderboard', { token, chain });
  }

  async getWhoBoughtSold(token: string, chain: Chain) {
    return this.callTool('token_who_bought_sold', { token, chain });
  }

  async getTokenTransfers(token: string, chain: Chain, page = 1) {
    return this.callTool('token_transfers', { token, chain, page });
  }

  async getRecentFlowsSummary(token: string, chain: Chain) {
    return this.callTool('token_recent_flows_summary', { token, chain });
  }

  async screenTokens(chains?: Chain[]) {
    // token_discovery_screener expects `parameters` (and optionally `filters`).
    // Keep it minimal to avoid extra credit usage and schema issues.
    const parameters: Record<string, unknown> = {
      chains: (chains && chains.length > 0) ? chains : ['base', 'ethereum'],
      timeframe: '24h',
    };
    return this.callTool('token_discovery_screener', { request: { parameters } });
  }

  async getTokenOhlcv(token: string, chain: Chain, interval = '1h') {
    return this.callTool('token_ohlcv', { token, chain, interval });
  }

  // ===========================================================================
  // Wallet Profiler Tools
  // ===========================================================================

  async getWalletPortfolio(address: string) {
    return this.callTool('address_portfolio', { address });
  }

  async getWalletPnlSummary(address: string) {
    return this.callTool('wallet_pnl_summary', { address });
  }

  async getWalletPnlForToken(address: string, token: string, chain: Chain) {
    return this.callTool('wallet_pnl_for_token', { address, token, chain });
  }

  async getAddressTransactions(address: string, page = 1) {
    return this.callTool('address_transactions', { address, page });
  }

  async getAddressTransactionsForToken(address: string, token: string, chain: Chain) {
    return this.callTool('address_transactions_for_token', { address, token, chain });
  }

  async getHistoricalBalances(address: string, chain: Chain) {
    return this.callTool('address_historical_balances', { address, chain });
  }

  async getRelatedAddresses(address: string) {
    return this.callTool('address_related_addresses', { address });
  }

  async getCounterparties(address: string) {
    return this.callTool('address_counterparties', { address });
  }

  // ===========================================================================
  // Misc Tools
  // ===========================================================================

  async search(query: string) {
    return this.callTool('general_search', { query });
  }

  async getChainRankings() {
    // MCP tool expects a `request` object even when empty.
    return this.callTool('growth_chain_rank', { request: {} });
  }

  async lookupTransaction(txHash: string, chain: Chain) {
    return this.callTool('transaction_lookup', { tx_hash: txHash, chain });
  }

  // ===========================================================================
  // Comprehensive Analysis (multiple tool calls)
  // ===========================================================================

  async analyzeToken(token: string, chain: Chain): Promise<{
    holders?: unknown;
    trades?: unknown;
    flows?: unknown;
    pnl?: unknown;
    whoBoughtSold?: unknown;
    errors: string[];
  }> {
    const result: {
      holders?: unknown;
      trades?: unknown;
      flows?: unknown;
      pnl?: unknown;
      whoBoughtSold?: unknown;
      errors: string[];
    } = { errors: [] };

    // Run all calls in parallel for speed
    const [holdersRes, tradesRes, flowsRes, pnlRes, whoBoughtSoldRes] = await Promise.allSettled([
      this.getTokenHolders(token, chain),
      this.getTokenDexTrades(token, chain, true),
      this.getRecentFlowsSummary(token, chain),
      this.getTokenPnlLeaderboard(token, chain),
      this.getWhoBoughtSold(token, chain),
    ]);

    if (holdersRes.status === 'fulfilled') result.holders = holdersRes.value;
    else result.errors.push(`holders: ${holdersRes.reason?.message || 'failed'}`);

    if (tradesRes.status === 'fulfilled') result.trades = tradesRes.value;
    else result.errors.push(`trades: ${tradesRes.reason?.message || 'failed'}`);

    if (flowsRes.status === 'fulfilled') result.flows = flowsRes.value;
    else result.errors.push(`flows: ${flowsRes.reason?.message || 'failed'}`);

    if (pnlRes.status === 'fulfilled') result.pnl = pnlRes.value;
    else result.errors.push(`pnl: ${pnlRes.reason?.message || 'failed'}`);

    if (whoBoughtSoldRes.status === 'fulfilled') result.whoBoughtSold = whoBoughtSoldRes.value;
    else result.errors.push(`whoBoughtSold: ${whoBoughtSoldRes.reason?.message || 'failed'}`);

    return result;
  }

  async analyzeWallet(address: string): Promise<{
    portfolio?: unknown;
    pnl?: unknown;
    transactions?: unknown;
    related?: unknown;
    counterparties?: unknown;
    errors: string[];
  }> {
    const result: {
      portfolio?: unknown;
      pnl?: unknown;
      transactions?: unknown;
      related?: unknown;
      counterparties?: unknown;
      errors: string[];
    } = { errors: [] };

    // Run all calls in parallel
    const [portfolioRes, pnlRes, txRes, relatedRes, counterpartiesRes] = await Promise.allSettled([
      this.getWalletPortfolio(address),
      this.getWalletPnlSummary(address),
      this.getAddressTransactions(address),
      this.getRelatedAddresses(address),
      this.getCounterparties(address),
    ]);

    if (portfolioRes.status === 'fulfilled') result.portfolio = portfolioRes.value;
    else result.errors.push(`portfolio: ${portfolioRes.reason?.message || 'failed'}`);

    if (pnlRes.status === 'fulfilled') result.pnl = pnlRes.value;
    else result.errors.push(`pnl: ${pnlRes.reason?.message || 'failed'}`);

    if (txRes.status === 'fulfilled') result.transactions = txRes.value;
    else result.errors.push(`transactions: ${txRes.reason?.message || 'failed'}`);

    if (relatedRes.status === 'fulfilled') result.related = relatedRes.value;
    else result.errors.push(`related: ${relatedRes.reason?.message || 'failed'}`);

    if (counterpartiesRes.status === 'fulfilled') result.counterparties = counterpartiesRes.value;
    else result.errors.push(`counterparties: ${counterpartiesRes.reason?.message || 'failed'}`);

    return result;
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  getToolCredits(tool: McpTool): number {
    return MCP_TOOLS[tool]?.credits ?? 1;
  }

  listTools() {
    return Object.entries(MCP_TOOLS).map(([name, info]) => ({ name: name as McpTool, ...info }));
  }
}

export function createMcp(apiKey?: string): NansenMcp {
  const key = apiKey || process.env.NANSEN_API_KEY;
  if (!key) throw new Error('NANSEN_API_KEY is required');
  return new NansenMcp(key);
}
