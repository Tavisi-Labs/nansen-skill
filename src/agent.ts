/**
 * NansenAgent - Unified interface for autonomous trading agents
 * Uses NansenData for MCP-first architecture with API fallback
 */

import { NansenData, createData, type MarketOverviewOptions } from './data.js';
import type { NansenClient } from './api.js';
import type { NansenMcp } from './mcp.js';
import type {
  Chain,
  ScanMode,
  OpportunitySignal,
  SmartMoneyRequest,
  OpportunityScanRequest,
} from './types.js';
import type { TokenRequest, AddressRequest } from './api.js';

export interface FindOpportunitiesOptions {
  chains?: Chain[];
  modes?: ScanMode[];
  limit?: number;
  analyzeTop?: number;
  minScore?: number;
}

export interface WatchOptions {
  chains?: Chain[];
  modes?: ScanMode[];
  threshold?: number;
  interval?: number;
}

export class NansenAgent {
  public readonly data: NansenData;

  // Expose underlying clients for backward compatibility
  public get api(): NansenClient { return this.data.api; }
  public get mcp(): NansenMcp { return this.data.mcp; }

  constructor(apiKey?: string) {
    this.data = createData({ apiKey });
  }

  /**
   * Find opportunities using API scan + optional MCP analysis
   */
  async findOpportunities(options: FindOpportunitiesOptions = {}): Promise<{
    allSignals: OpportunitySignal[];
    topSignals: OpportunitySignal[];
    timestamp: string;
  }> {
    const {
      chains = ['ethereum', 'base', 'arbitrum'],
      modes = ['accumulation'],
      limit = 10,
      analyzeTop = 0,
      minScore = 1,
    } = options;

    const allSignals: OpportunitySignal[] = [];

    // Fast API scan via unified data layer
    for (const chain of chains) {
      for (const mode of modes) {
        try {
          const signals = await this.data.scanOpportunities({ chain, mode, limit });
          allSignals.push(...signals.filter(s => s.score >= minScore));
        } catch (error) {
          console.error(`Scan error ${chain}/${mode}:`, (error as Error).message);
        }
      }
    }

    // Dedupe and sort
    const seen = new Set<string>();
    const uniqueSignals = allSignals
      .sort((a, b) => b.score - a.score)
      .filter(s => {
        const key = `${s.chain}:${s.token}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const topSignals = uniqueSignals.slice(0, Math.max(analyzeTop, limit));

    // MCP analysis for top signals via unified data layer
    if (analyzeTop > 0) {
      for (const signal of topSignals.slice(0, analyzeTop)) {
        try {
          const analysis = await this.data.getTokenInfo(signal.token, signal.chain);
          (signal as any).mcpAnalysis = analysis;
        } catch (error) {
          (signal as any).mcpAnalysis = { error: (error as Error).message };
        }
      }
    }

    return {
      allSignals: uniqueSignals,
      topSignals,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Watch for signals with callback
   */
  watch(options: WatchOptions, onSignal: (signal: OpportunitySignal) => void | Promise<void>): () => void {
    const {
      chains = ['ethereum'],
      modes = ['accumulation'],
      threshold = 10000,
      interval = 60000,
    } = options;

    const seenKeys = new Set<string>();

    const scan = async () => {
      for (const chain of chains) {
        for (const mode of modes) {
          try {
            const signals = await this.data.scanOpportunities({ chain, mode, limit: 50 });

            for (const signal of signals) {
              const value = signal.metrics.netflow24h || signal.metrics.amountUsd || 0;
              if (Math.abs(value) < threshold) continue;

              const key = `${signal.chain}:${signal.token}:${signal.type}`;
              if (seenKeys.has(key)) continue;

              seenKeys.add(key);
              setTimeout(() => seenKeys.delete(key), 3600000);

              await onSignal(signal);
            }
          } catch (error) {
            console.error(`Watch error ${chain}/${mode}:`, (error as Error).message);
          }
        }
      }
    };

    scan();
    const intervalId = setInterval(scan, interval);
    return () => clearInterval(intervalId);
  }

  /**
   * Watch with webhook
   */
  async watchWithWebhook(options: WatchOptions & { webhook: string }): Promise<() => void> {
    const { webhook, ...watchOptions } = options;

    return this.watch(watchOptions, async (signal) => {
      try {
        await fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'nansen_signal', signal, timestamp: new Date().toISOString() }),
        });
      } catch (error) {
        console.error('Webhook error:', (error as Error).message);
      }
    });
  }

  // Convenience methods - unified data layer (MCP-first with API fallback)
  async getSmartMoneyNetflow(params: SmartMoneyRequest) { return this.data.getSmartMoneyNetflow(params); }
  async getSmartMoneyHoldings(params: SmartMoneyRequest) { return this.data.getSmartMoneyHoldings(params); }
  async getSmartMoneyDexTrades(params: SmartMoneyRequest) { return this.data.getSmartMoneyDexTrades(params); }
  async getTokenHolders(token: string, chain: Chain, limit?: number) { return this.data.getTokenHolders(token, chain, limit); }
  async getTokenFlows(token: string, chain: Chain) { return this.data.getTokenFlows(token, chain); }
  async getTokenDexTrades(token: string, chain: Chain, options?: { onlySmartMoney?: boolean }) { return this.data.getTokenDexTrades(token, chain, options); }
  async getWalletBalances(address: string, chain: Chain) { return this.data.getWalletBalances(address, chain); }
  async getRelatedWallets(address: string, chain?: Chain) { return this.data.getRelatedWallets(address, chain); }
  async scan(params: OpportunityScanRequest) { return this.data.scanOpportunities(params); }

  // MCP-specific methods
  async analyzeToken(token: string, chain: Chain) { return this.data.getTokenInfo(token, chain); }
  async analyzeWallet(address: string) { return this.data.getWalletProfile(address); }
  async search(query: string) { return this.data.search(query); }
  async screenTokens(chains: Chain[]) { return this.data.screenTokens(chains); }

  // High-level market overview (single call, parallel fetch)
  async getMarketOverview(options?: MarketOverviewOptions | Chain[]) { return this.data.getMarketOverview(options); }

  // Polymarket-focused overview (Polygon + prediction markets)
  async getPolymarketOverview(analyzeContracts?: boolean) { return this.data.getPolymarketOverview(analyzeContracts); }
}

export function createAgent(apiKey?: string): NansenAgent {
  return new NansenAgent(apiKey);
}

export default NansenAgent;
