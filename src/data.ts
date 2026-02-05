/**
 * NansenData - Unified Data Layer
 *
 * MCP-first architecture with API fallback.
 * Routes requests to the best data source for each operation.
 *
 * MCP advantages:
 * - Token screening (token_discovery_screener)
 * - Wallet PnL (wallet_pnl_summary)
 * - Search (general_search - free!)
 * - More comprehensive token analysis
 *
 * API advantages:
 * - Faster for bulk smart money queries
 * - More structured responses
 * - Better for real-time netflow data
 */

import {
  NansenClient,
  createClient,
  type TokenRequest,
  type AddressRequest,
  type DateRange,
  type SmartMoneyHolding,
  type SmartMoneyDexTrade,
  type TokenHolder,
  type TokenFlow,
  type DexTrade,
  type WalletBalance,
  type RelatedWallet,
} from './api.js';
import { NansenMcp, createMcp, NansenMcpError } from './mcp.js';
import type { Chain, SmartMoneyRequest, SmartMoneyNetflow, OpportunityScanRequest, OpportunitySignal } from './types.js';

export interface DataConfig {
  apiKey?: string;
  preferMcp?: boolean;  // Default true - use MCP as primary
  fallbackToApi?: boolean;  // Default true - fall back to API on MCP failure
}

export interface ScreenerToken {
  address: string;
  symbol: string;
  name?: string;
  chain: Chain;
  price?: number;
  priceChange24h?: number;
  volume24h?: number;
  marketCap?: number;
  holders?: number;
  netflowUsd?: number;
  smartMoneyFlow?: number;
}

export interface WalletSummary {
  address: string;
  totalValueUsd: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  winRate?: number;
  topHoldings: Array<{
    symbol: string;
    chain: Chain;
    valueUsd: number;
    amount: number;
  }>;
  recentActivity?: unknown;
  relatedWallets?: Array<{
    address: string;
    label?: string;
    relationship?: string;
  }>;
}

export interface TokenSummary {
  address: string;
  chain: Chain;
  symbol?: string;
  name?: string;
  holders: Array<{
    address: string;
    label?: string;
    ownershipPercent: number;
    valueUsd: number;
  }>;
  flows?: unknown;
  trades?: unknown;
  pnlLeaderboard?: unknown;
  whoBoughtSold?: unknown;
}

export interface TokenOhlcv {
  token: string;
  chain: Chain;
  symbol?: string;
  interval: string;
  data: unknown;
  volatility?: number; // Calculated from OHLCV if available
}

export interface MarketOverviewOptions {
  chains?: Chain[];
  topOhlcvCount?: number; // Number of top tokens to fetch OHLCV for (default: 0, max recommended: 5)
  ohlcvInterval?: string; // OHLCV interval (default: '1h')
}

export interface MarketOverview {
  timestamp: string;
  chains: Chain[];
  hotTokens: ScreenerToken[];
  smartMoneyActivity: {
    netflows: SmartMoneyNetflow[];
    topAccumulating: SmartMoneyNetflow[];
    topDistributing: SmartMoneyNetflow[];
  };
  chainRankings?: unknown;
  topTokensOhlcv?: TokenOhlcv[]; // OHLCV for top tokens (1 credit each)
  errors: string[];
}

export interface PolymarketOverview {
  timestamp: string;
  searchResults?: unknown;
  polygonActivity: {
    hotTokens: ScreenerToken[];
    smartMoneyNetflows: SmartMoneyNetflow[];
    topAccumulating: SmartMoneyNetflow[];
  };
  knownContracts: {
    ctfExchange: string;
    conditionalTokens: string;
  };
  contractAnalysis?: {
    ctfExchangeHolders?: unknown;
    ctfExchangeFlows?: unknown;
  };
  errors: string[];
}

export class NansenData {
  public readonly mcp: NansenMcp;
  public readonly api: NansenClient;
  private preferMcp: boolean;
  private fallbackToApi: boolean;

  constructor(config: DataConfig = {}) {
    const apiKey = config.apiKey || process.env.NANSEN_API_KEY;
    if (!apiKey) {
      throw new Error('NANSEN_API_KEY is required');
    }

    this.mcp = createMcp(apiKey);
    this.api = createClient(apiKey);
    this.preferMcp = config.preferMcp ?? true;
    this.fallbackToApi = config.fallbackToApi ?? true;
  }

  // ===========================================================================
  // MCP-First Methods (MCP has better coverage)
  // ===========================================================================

  /**
   * Screen tokens for hot opportunities
   * MCP: token_discovery_screener (no API equivalent)
   */
  async screenTokens(chains: Chain[] = ['base']): Promise<ScreenerToken[]> {
    try {
      const result = await this.mcp.screenTokens(chains);
      return this.normalizeScreenerResult(result, chains[0]);
    } catch (error) {
      // No API fallback - screener is MCP-only
      throw error;
    }
  }

  /**
   * Get high-level market overview in a single call
   * Fetches hot tokens, smart money activity, chain rankings, and optionally OHLCV for top tokens
   * This is the recommended entry point for market scanning
   *
   * @param options.chains - Chains to scan (default: base, ethereum, arbitrum, polygon)
   * @param options.topOhlcvCount - Number of top tokens to fetch OHLCV for (default: 0, costs 1 credit each)
   * @param options.ohlcvInterval - OHLCV interval (default: '1h')
   */
  async getMarketOverview(options: MarketOverviewOptions | Chain[] = {}): Promise<MarketOverview> {
    // Support legacy array signature
    const opts: MarketOverviewOptions = Array.isArray(options)
      ? { chains: options }
      : options;

    const chains = opts.chains ?? ['base', 'ethereum', 'arbitrum', 'polygon'];
    const topOhlcvCount = Math.min(opts.topOhlcvCount ?? 0, 10); // Cap at 10 to limit credit burn
    const ohlcvInterval = opts.ohlcvInterval ?? '1h';
    const errors: string[] = [];

    // Parallel fetch: MCP screener + API smart money + MCP chain rankings
    const [screenerResult, netflowResults, chainRankings] = await Promise.allSettled([
      this.mcp.screenTokens(chains),
      Promise.all(chains.map(chain =>
        this.api.getSmartMoneyNetflow({ chain, limit: 20 }).catch(e => {
          errors.push(`netflow/${chain}: ${e.message}`);
          return [];
        })
      )),
      this.mcp.getChainRankings().catch(e => {
        errors.push(`chainRankings: ${e.message}`);
        return null;
      }),
    ]);

    // Process screener results
    let hotTokens: ScreenerToken[] = [];
    if (screenerResult.status === 'fulfilled') {
      hotTokens = this.normalizeScreenerResult(screenerResult.value, chains[0]);
    } else {
      errors.push(`screener: ${screenerResult.reason?.message || 'failed'}`);
    }

    // Process netflow results
    let allNetflows: SmartMoneyNetflow[] = [];
    if (netflowResults.status === 'fulfilled') {
      allNetflows = netflowResults.value.flat();
    }

    // Sort and categorize netflows
    const sorted = [...allNetflows].sort((a, b) => Math.abs(b.netflowUsd) - Math.abs(a.netflowUsd));
    const topAccumulating = sorted.filter(n => n.netflow > 0).slice(0, 10);
    const topDistributing = sorted.filter(n => n.netflow < 0).slice(0, 10);

    // Fetch OHLCV for top tokens (if requested)
    let topTokensOhlcv: TokenOhlcv[] | undefined;
    if (topOhlcvCount > 0 && hotTokens.length > 0) {
      const tokensToFetch = hotTokens.slice(0, topOhlcvCount).filter(t => t.address && t.chain);

      const ohlcvResults = await Promise.allSettled(
        tokensToFetch.map(async (token): Promise<TokenOhlcv | null> => {
          try {
            const data = await this.mcp.getTokenOhlcv(token.address, token.chain, ohlcvInterval);
            return {
              token: token.address,
              chain: token.chain,
              symbol: token.symbol,
              interval: ohlcvInterval,
              data,
              volatility: this.calculateVolatility(data),
            };
          } catch (e: any) {
            errors.push(`ohlcv/${token.symbol || token.address}: ${e.message}`);
            return null;
          }
        })
      );

      topTokensOhlcv = ohlcvResults
        .filter((r): r is PromiseFulfilledResult<TokenOhlcv | null> => r.status === 'fulfilled')
        .map(r => r.value)
        .filter((v): v is TokenOhlcv => v !== null);
    }

    return {
      timestamp: new Date().toISOString(),
      chains,
      hotTokens: hotTokens.slice(0, 20),
      smartMoneyActivity: {
        netflows: sorted.slice(0, 30),
        topAccumulating,
        topDistributing,
      },
      chainRankings: chainRankings.status === 'fulfilled' ? chainRankings.value : null,
      topTokensOhlcv,
      errors,
    };
  }

  /**
   * Calculate simple volatility from OHLCV data
   * Returns standard deviation of returns as a percentage
   */
  private calculateVolatility(ohlcvData: unknown): number | undefined {
    try {
      // Handle various OHLCV response formats
      let candles: Array<{ close?: number; c?: number }> = [];

      if (Array.isArray(ohlcvData)) {
        candles = ohlcvData;
      } else if (typeof ohlcvData === 'object' && ohlcvData !== null) {
        const obj = ohlcvData as Record<string, unknown>;
        if (Array.isArray(obj.data)) candles = obj.data;
        else if (Array.isArray(obj.candles)) candles = obj.candles;
        else if (Array.isArray(obj.ohlcv)) candles = obj.ohlcv;
      }

      if (candles.length < 2) return undefined;

      // Extract close prices
      const closes = candles
        .map(c => c.close ?? c.c)
        .filter((c): c is number => typeof c === 'number' && c > 0);

      if (closes.length < 2) return undefined;

      // Calculate returns
      const returns: number[] = [];
      for (let i = 1; i < closes.length; i++) {
        returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
      }

      // Calculate standard deviation
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
      const stdDev = Math.sqrt(variance);

      // Return as percentage
      return Math.round(stdDev * 10000) / 100;
    } catch {
      return undefined;
    }
  }

  /**
   * Get Polymarket-focused overview
   * Polymarket runs on Polygon using conditional tokens (CTF)
   * This aggregates Polygon activity + searches for Polymarket-related data
   */
  async getPolymarketOverview(analyzeContracts = false): Promise<PolymarketOverview> {
    const errors: string[] = [];

    // Known Polymarket contracts on Polygon
    const POLYMARKET_CONTRACTS = {
      ctfExchange: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
      conditionalTokens: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
    };

    // Parallel fetch: search + polygon screener + polygon netflows
    const [searchResult, screenerResult, netflowResult] = await Promise.allSettled([
      this.mcp.search('polymarket prediction market polygon').catch(e => {
        errors.push(`search: ${e.message}`);
        return null;
      }),
      this.mcp.screenTokens(['polygon']).catch(e => {
        errors.push(`screener: ${e.message}`);
        return [];
      }),
      this.api.getSmartMoneyNetflow({ chain: 'polygon', limit: 30 }).catch(e => {
        errors.push(`netflow: ${e.message}`);
        return [];
      }),
    ]);

    // Process results
    const searchResults = searchResult.status === 'fulfilled' ? searchResult.value : null;

    let hotTokens: ScreenerToken[] = [];
    if (screenerResult.status === 'fulfilled' && screenerResult.value) {
      hotTokens = this.normalizeScreenerResult(screenerResult.value, 'polygon');
    }

    let netflows: SmartMoneyNetflow[] = [];
    if (netflowResult.status === 'fulfilled') {
      netflows = netflowResult.value;
    }

    const topAccumulating = netflows.filter(n => n.netflow > 0).slice(0, 10);

    // Optionally analyze known contracts
    let contractAnalysis: PolymarketOverview['contractAnalysis'];
    if (analyzeContracts) {
      const [holdersResult, flowsResult] = await Promise.allSettled([
        this.mcp.getTokenHolders(POLYMARKET_CONTRACTS.ctfExchange, 'polygon', 25).catch(e => {
          errors.push(`ctfHolders: ${e.message}`);
          return null;
        }),
        this.mcp.getRecentFlowsSummary(POLYMARKET_CONTRACTS.ctfExchange, 'polygon').catch(e => {
          errors.push(`ctfFlows: ${e.message}`);
          return null;
        }),
      ]);

      contractAnalysis = {
        ctfExchangeHolders: holdersResult.status === 'fulfilled' ? holdersResult.value : null,
        ctfExchangeFlows: flowsResult.status === 'fulfilled' ? flowsResult.value : null,
      };
    }

    return {
      timestamp: new Date().toISOString(),
      searchResults,
      polygonActivity: {
        hotTokens: hotTokens.slice(0, 15),
        smartMoneyNetflows: netflows,
        topAccumulating,
      },
      knownContracts: POLYMARKET_CONTRACTS,
      contractAnalysis,
      errors,
    };
  }

  /**
   * Get comprehensive token analysis
   * MCP: Multiple tools in parallel (holders, trades, flows, pnl, who bought/sold)
   * API fallback: getTokenAnalysis (limited)
   */
  async getTokenInfo(token: string, chain: Chain): Promise<TokenSummary> {
    if (this.preferMcp) {
      try {
        const mcpResult = await this.mcp.analyzeToken(token, chain);
        return this.normalizeMcpTokenAnalysis(token, chain, mcpResult);
      } catch (error) {
        if (!this.fallbackToApi) throw error;
        // Fall through to API
      }
    }

    // API fallback
    const apiResult = await this.api.getTokenAnalysis({
      chain,
      tokenAddress: token,
    });
    return this.normalizeApiTokenAnalysis(token, chain, apiResult);
  }

  /**
   * Get wallet profile with PnL
   * MCP: wallet_pnl_summary + address_portfolio (comprehensive)
   * API fallback: current-balance + related-wallets (limited)
   */
  async getWalletProfile(address: string, chain?: Chain): Promise<WalletSummary> {
    if (this.preferMcp) {
      try {
        const mcpResult = await this.mcp.analyzeWallet(address);
        return this.normalizeMcpWalletAnalysis(address, mcpResult);
      } catch (error) {
        if (!this.fallbackToApi || !chain) throw error;
        // Fall through to API (requires chain)
      }
    }

    if (!chain) {
      throw new Error('Chain required for API fallback. Provide chain parameter or enable MCP.');
    }

    // API fallback
    const [balances, related] = await Promise.all([
      this.api.getWalletBalances({ address, chain }),
      this.api.getRelatedWallets({ address, chain }),
    ]);

    return {
      address,
      totalValueUsd: balances.reduce((sum, b) => sum + b.valueUsd, 0),
      topHoldings: balances.slice(0, 10).map(b => ({
        symbol: b.symbol,
        chain: b.chain,
        valueUsd: b.valueUsd,
        amount: b.amount,
      })),
      relatedWallets: related.slice(0, 5).map(r => ({
        address: r.address,
        label: r.label,
        relationship: r.relationship,
      })),
    };
  }

  /**
   * Search for tokens, wallets, entities
   * MCP: general_search (free, no credits!)
   */
  async search(query: string): Promise<unknown> {
    return this.mcp.search(query);
  }

  /**
   * Get chain rankings
   * MCP: growth_chain_rank (no API equivalent)
   */
  async getChainRankings(): Promise<unknown> {
    return this.mcp.getChainRankings();
  }

  /**
   * Get token OHLCV data
   * MCP: token_ohlcv (no API equivalent)
   */
  async getTokenOhlcv(token: string, chain: Chain, interval = '1h'): Promise<unknown> {
    return this.mcp.getTokenOhlcv(token, chain, interval);
  }

  /**
   * Get wallet PnL summary
   * MCP: wallet_pnl_summary (no API equivalent)
   */
  async getWalletPnl(address: string): Promise<unknown> {
    return this.mcp.getWalletPnlSummary(address);
  }

  /**
   * Get counterparties for a wallet
   * MCP: address_counterparties (no API equivalent)
   */
  async getCounterparties(address: string): Promise<unknown> {
    return this.mcp.getCounterparties(address);
  }

  // ===========================================================================
  // API-First Methods (API is faster/better)
  // ===========================================================================

  /**
   * Get smart money netflow
   * API: /smart-money/netflow (faster for bulk queries)
   * MCP fallback: smart_traders_and_funds_netflows
   */
  async getSmartMoneyNetflow(params: SmartMoneyRequest): Promise<SmartMoneyNetflow[]> {
    try {
      return await this.api.getSmartMoneyNetflow(params);
    } catch (error) {
      if (!this.fallbackToApi) throw error;

      // MCP fallback - returns raw data, cast to match API type
      const chain = params.chain || (params.chains?.[0] as Chain);
      if (!chain) throw error;
      return this.mcp.getSmartTraderNetflows(chain) as Promise<SmartMoneyNetflow[]>;
    }
  }

  /**
   * Get smart money holdings
   * API: /smart-money/holdings (structured response)
   * MCP fallback: smart_traders_and_funds_token_balances
   */
  async getSmartMoneyHoldings(params: SmartMoneyRequest): Promise<SmartMoneyHolding[]> {
    try {
      return await this.api.getSmartMoneyHoldings(params);
    } catch (error) {
      if (!this.fallbackToApi) throw error;

      const chain = params.chain || (params.chains?.[0] as Chain);
      if (!chain) throw error;
      return this.mcp.getSmartTraderBalances(chain) as Promise<SmartMoneyHolding[]>;
    }
  }

  /**
   * Get smart money DEX trades
   * API: /smart-money/dex-trades (structured)
   */
  async getSmartMoneyDexTrades(params: SmartMoneyRequest): Promise<SmartMoneyDexTrade[]> {
    return this.api.getSmartMoneyDexTrades(params);
  }

  /**
   * Scan for opportunities
   * API: scanOpportunities (fast composite method)
   */
  async scanOpportunities(params: OpportunityScanRequest): Promise<OpportunitySignal[]> {
    return this.api.scanOpportunities(params);
  }

  // ===========================================================================
  // Hybrid Methods (use both sources)
  // ===========================================================================

  /**
   * Get token holders
   * Try MCP first for richer data, fall back to API
   */
  async getTokenHolders(token: string, chain: Chain, limit = 25): Promise<TokenHolder[]> {
    if (this.preferMcp) {
      try {
        return await this.mcp.getTokenHolders(token, chain, limit) as TokenHolder[];
      } catch (error) {
        if (!this.fallbackToApi) throw error;
      }
    }

    return this.api.getTokenHolders({
      chain,
      tokenAddress: token,
      limit,
    });
  }

  /**
   * Get token DEX trades
   * Try MCP first, fall back to API
   */
  async getTokenDexTrades(token: string, chain: Chain, options?: { onlySmartMoney?: boolean; date?: DateRange }): Promise<DexTrade[]> {
    if (this.preferMcp) {
      try {
        return await this.mcp.getTokenDexTrades(token, chain, options?.onlySmartMoney ?? false) as DexTrade[];
      } catch (error) {
        if (!this.fallbackToApi) throw error;
      }
    }

    return this.api.getTokenDexTrades({
      chain,
      tokenAddress: token,
      date: options?.date,
    });
  }

  /**
   * Get token flows
   * Try MCP first, fall back to API
   */
  async getTokenFlows(token: string, chain: Chain, date?: DateRange): Promise<TokenFlow[]> {
    if (this.preferMcp) {
      try {
        return await this.mcp.getRecentFlowsSummary(token, chain) as TokenFlow[];
      } catch (error) {
        if (!this.fallbackToApi) throw error;
      }
    }

    return this.api.getTokenFlows({
      chain,
      tokenAddress: token,
      date,
    });
  }

  /**
   * Get wallet balances
   * API is more structured, but MCP has more context
   */
  async getWalletBalances(address: string, chain: Chain): Promise<WalletBalance[]> {
    return this.api.getWalletBalances({ address, chain });
  }

  /**
   * Get related wallets
   * Try MCP first for more relationships
   */
  async getRelatedWallets(address: string, chain?: Chain): Promise<RelatedWallet[]> {
    if (this.preferMcp) {
      try {
        return await this.mcp.getRelatedAddresses(address) as RelatedWallet[];
      } catch (error) {
        if (!this.fallbackToApi || !chain) throw error;
      }
    }

    if (!chain) {
      throw new Error('Chain required for API fallback');
    }

    return this.api.getRelatedWallets({ address, chain });
  }

  // ===========================================================================
  // Normalization Helpers
  // ===========================================================================

  private normalizeScreenerResult(result: unknown, defaultChain: Chain): ScreenerToken[] {
    // MCP returns text/markdown - parse it
    if (typeof result === 'string') {
      // Try to extract structured data from markdown
      return this.parseMarkdownTable(result, defaultChain);
    }

    // If it's already structured
    if (Array.isArray(result)) {
      return result.map((item: any) => ({
        address: item.token_address || item.address || '',
        symbol: item.token_symbol || item.symbol || '',
        name: item.token_name || item.name,
        chain: (item.chain || defaultChain) as Chain,
        price: item.price,
        priceChange24h: item.price_change_24h,
        volume24h: item.volume_24h,
        marketCap: item.market_cap,
        holders: item.holders,
        netflowUsd: item.net_flow_usd || item.netflow_usd,
        smartMoneyFlow: item.smart_money_netflow,
      }));
    }

    return [];
  }

  private parseMarkdownTable(markdown: string, defaultChain: Chain): ScreenerToken[] {
    // Simple markdown table parser for MCP responses
    const lines = markdown.split('\n').filter(l => l.trim() && !l.startsWith('|--'));
    const tokens: ScreenerToken[] = [];

    for (const line of lines) {
      if (!line.includes('|')) continue;

      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length < 2) continue;

      // Skip header row
      if (cells[0].toLowerCase() === 'token' || cells[0].toLowerCase() === 'symbol') continue;

      // Try to extract token info from cells
      const token: ScreenerToken = {
        address: '',
        symbol: cells[0] || '',
        chain: defaultChain,
      };

      // Look for address pattern (0x...)
      for (const cell of cells) {
        if (cell.match(/^0x[a-fA-F0-9]{40}$/)) {
          token.address = cell;
        }
        // Look for numbers that might be prices/volumes
        const num = parseFloat(cell.replace(/[$,]/g, ''));
        if (!isNaN(num)) {
          if (!token.price) token.price = num;
          else if (!token.volume24h) token.volume24h = num;
        }
      }

      if (token.symbol) {
        tokens.push(token);
      }
    }

    return tokens;
  }

  private normalizeMcpTokenAnalysis(token: string, chain: Chain, result: any): TokenSummary {
    return {
      address: token,
      chain,
      holders: Array.isArray(result.holders) ? result.holders.map((h: any) => ({
        address: h.address || '',
        label: h.label || h.address_label,
        ownershipPercent: h.ownership_percentage ? h.ownership_percentage * 100 : h.ownershipPercent || 0,
        valueUsd: h.value_usd || h.valueUsd || 0,
      })) : [],
      flows: result.flows,
      trades: result.trades,
      pnlLeaderboard: result.pnl,
      whoBoughtSold: result.whoBoughtSold,
    };
  }

  private normalizeApiTokenAnalysis(token: string, chain: Chain, result: any): TokenSummary {
    return {
      address: token,
      chain,
      holders: Array.isArray(result.holders) ? result.holders.map((h: any) => ({
        address: h.address || '',
        label: h.label,
        ownershipPercent: h.ownershipPercent || 0,
        valueUsd: h.valueUsd || 0,
      })) : [],
      flows: result.flows,
      trades: result.recentTrades,
      whoBoughtSold: result.whoBoughtSold,
    };
  }

  private normalizeMcpWalletAnalysis(address: string, result: any): WalletSummary {
    const portfolio = result.portfolio;
    const pnl = result.pnl;

    return {
      address,
      totalValueUsd: portfolio?.total_value_usd || portfolio?.totalValueUsd || 0,
      realizedPnl: pnl?.realized_pnl || pnl?.realizedPnl,
      unrealizedPnl: pnl?.unrealized_pnl || pnl?.unrealizedPnl,
      winRate: pnl?.win_rate || pnl?.winRate,
      topHoldings: Array.isArray(portfolio?.holdings) ? portfolio.holdings.slice(0, 10).map((h: any) => ({
        symbol: h.token_symbol || h.symbol || '',
        chain: (h.chain || 'ethereum') as Chain,
        valueUsd: h.value_usd || h.valueUsd || 0,
        amount: h.token_amount || h.amount || 0,
      })) : [],
      recentActivity: result.transactions,
      relatedWallets: Array.isArray(result.related) ? result.related.slice(0, 5).map((r: any) => ({
        address: r.address || '',
        label: r.label,
        relationship: r.relationship,
      })) : [],
    };
  }
}

export function createData(config?: DataConfig): NansenData {
  return new NansenData(config);
}
