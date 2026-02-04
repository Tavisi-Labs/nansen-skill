#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { NansenClient, NansenApiError } from './api.js';
import { NansenMcp, NansenMcpError, MCP_TOOLS, type McpTool } from './mcp.js';
import { NansenAgent } from './agent.js';
import { NansenTrader, type TradingSignal } from './trader.js';
import type {
  Chain,
  WalletLabel,
  Timeframe,
  ScanMode,
  FlowDirection,
  SmartMoneyNetflow,
  TokenScreenerResult,
  DexTrade,
  TokenFlow,
  WalletProfile,
  OpportunitySignal,
} from './types.js';

const program = new Command();

let client: NansenClient;

function getClient(): NansenClient {
  if (!client) {
    try {
      client = new NansenClient();
    } catch (error: any) {
      console.error(chalk.red(error.message));
      console.log('\nSet your API key:');
      console.log('  export NANSEN_API_KEY=your_key_here');
      process.exit(1);
    }
  }
  return client;
}

function formatNumber(num: number): string {
  if (Math.abs(num) >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (Math.abs(num) >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (Math.abs(num) >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
}

function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function handleError(error: any): never {
  if (error instanceof NansenApiError) {
    console.error(chalk.red(`API Error [${error.code}]: ${error.message}`));
    if (error.details) {
      console.error(chalk.dim(JSON.stringify(error.details, null, 2)));
    }
  } else {
    console.error(chalk.red(`Error: ${error.message}`));
  }
  process.exit(1);
}

program
  .name('nansen')
  .description('Nansen trading intelligence CLI')
  .version('1.0.0');

// =============================================================================
// Streamlined Commands (JSON-first)
// =============================================================================

program
  .command('hot <chain>')
  .description('Top tokens by smart money flow on a chain')
  .option('-l, --limit <n>', 'Number of results', parseInt, 10)
  .option('-t, --timeframe <tf>', 'Timeframe: 1h, 24h, 7d', '24h')
  .option('--pretty', 'Pretty print output')
  .action(async (chain: Chain, options) => {
    try {
      const [netflow, screened] = await Promise.all([
        getClient().getSmartMoneyNetflow({
          chain,
          direction: 'inflow',
          timeframe: options.timeframe,
          limit: options.limit,
        }),
        getClient().screenTokens({
          chain,
          onlySmartMoney: true,
          sort: 'netflow',
          limit: options.limit,
        }),
      ]);

      const result = {
        chain,
        timeframe: options.timeframe,
        timestamp: new Date().toISOString(),
        hotTokens: netflow.map(t => ({
          token: t.token,
          symbol: t.symbol,
          netflowUsd: t.netflowUsd,
          buyers: t.buyersCount,
          sellers: t.sellersCount,
          signal: t.buyersCount > t.sellersCount * 2 ? 'strong_accumulation' :
                  t.buyersCount > t.sellersCount ? 'accumulation' : 'mixed',
        })),
        topScreened: screened.slice(0, 5).map(t => ({
          token: t.token,
          symbol: t.symbol,
          price: t.price,
          priceChange24h: t.priceChange24h,
          smartMoneyNetflow: t.smartMoneyNetflow,
          holders: t.holders,
        })),
      };

      console.log(JSON.stringify(result, null, options.pretty ? 2 : 0));
    } catch (error: any) {
      console.log(JSON.stringify({ error: error.message }));
      process.exit(1);
    }
  });

program
  .command('token <address>')
  .description('Token summary: flows, holders, notable wallets')
  .requiredOption('-c, --chain <chain>', 'Chain (ethereum, base, arbitrum, etc.)')
  .option('--pretty', 'Pretty print output')
  .action(async (address: string, options) => {
    try {
      const [info, holders, smHolders, netflow] = await Promise.allSettled([
        getClient().getTokenInfo({ address, chain: options.chain }),
        getClient().getTokenHolders(address, options.chain),
        getClient().getSmartMoneyHolders(address, options.chain),
        getClient().getSmartMoneyNetflow({ chain: options.chain, token: address }),
      ]);

      const tokenInfo = info.status === 'fulfilled' ? info.value : null;
      const holderData = holders.status === 'fulfilled' ? holders.value : [];
      const smHolderData = smHolders.status === 'fulfilled' ? smHolders.value : [];
      const flowData = netflow.status === 'fulfilled' ? netflow.value[0] : null;

      const result = {
        token: address,
        chain: options.chain,
        timestamp: new Date().toISOString(),
        info: tokenInfo ? {
          symbol: tokenInfo.symbol,
          name: tokenInfo.name,
          price: tokenInfo.price,
          marketCap: tokenInfo.marketCap,
          volume24h: tokenInfo.volume24h,
          liquidity: tokenInfo.liquidity,
          holders: tokenInfo.holders,
        } : null,
        smartMoneyFlow: flowData ? {
          netflowUsd: flowData.netflowUsd,
          inflowUsd: flowData.inflowUsd,
          outflowUsd: flowData.outflowUsd,
          buyers: flowData.buyersCount,
          sellers: flowData.sellersCount,
          signal: flowData.buyersCount > flowData.sellersCount ? 'accumulation' : 'distribution',
        } : null,
        holderBreakdown: holderData.slice(0, 5),
        notableWallets: smHolderData.slice(0, 5).map(w => ({
          address: w.address,
          labels: w.labels,
          totalValue: w.totalValue,
          winRate: w.winRate,
        })),
      };

      console.log(JSON.stringify(result, null, options.pretty ? 2 : 0));
    } catch (error: any) {
      console.log(JSON.stringify({ error: error.message }));
      process.exit(1);
    }
  });

program
  .command('address <addr>')
  .description('Wallet summary: labels, behavior, holdings')
  .option('--pretty', 'Pretty print output')
  .action(async (addr: string, options) => {
    try {
      const [profile, holdings, trades] = await Promise.allSettled([
        getClient().getWalletProfile({ address: addr }),
        getClient().getWalletHoldings(addr),
        getClient().getWalletTrades(addr, 10),
      ]);

      const profileData = profile.status === 'fulfilled' ? profile.value : null;
      const holdingsData = holdings.status === 'fulfilled' ? holdings.value : [];
      const tradesData = trades.status === 'fulfilled' ? trades.value : [];

      const result = {
        address: addr,
        timestamp: new Date().toISOString(),
        profile: profileData ? {
          labels: profileData.labels,
          totalValue: profileData.totalValue,
          realizedPnl: profileData.realizedPnl,
          winRate: profileData.winRate,
          tradesCount: profileData.tradesCount,
          firstSeen: profileData.firstSeen,
          lastActive: profileData.lastActive,
        } : null,
        topHoldings: holdingsData.slice(0, 5).map(h => ({
          symbol: h.symbol,
          chain: h.chain,
          value: h.value,
          pnl: h.pnl,
          pnlPercent: h.pnlPercent,
        })),
        recentTrades: tradesData.slice(0, 5).map(t => ({
          symbol: t.symbol,
          side: t.side,
          amountUsd: t.amountUsd,
          timestamp: t.timestamp,
        })),
        behavior: profileData ? {
          type: profileData.labels.includes('smart_money') ? 'smart_money' :
                profileData.labels.includes('whale') ? 'whale' :
                profileData.winRate > 0.6 ? 'profitable_trader' : 'retail',
          riskLevel: profileData.tradesCount > 100 ? 'active' : 'moderate',
        } : null,
      };

      console.log(JSON.stringify(result, null, options.pretty ? 2 : 0));
    } catch (error: any) {
      console.log(JSON.stringify({ error: error.message }));
      process.exit(1);
    }
  });

program
  .command('alerts')
  .description('Recent trading signals from signal log')
  .option('-l, --limit <n>', 'Number of alerts', parseInt, 10)
  .option('-c, --chain <chain>', 'Filter by chain')
  .option('--min-score <n>', 'Minimum score', parseFloat, 3)
  .option('--pretty', 'Pretty print output')
  .action(async (options) => {
    try {
      const signals = getTrader().getRecentSignals(options.limit * 2);

      let filtered = signals.filter(s => s.score >= options.minScore);
      if (options.chain) {
        filtered = filtered.filter(s => s.chain === options.chain);
      }

      const result = {
        timestamp: new Date().toISOString(),
        count: Math.min(filtered.length, options.limit),
        alerts: filtered.slice(0, options.limit).map(s => ({
          id: s.id,
          token: s.token,
          symbol: s.symbol,
          chain: s.chain,
          type: s.type,
          score: s.score,
          reason: s.reason,
          loggedAt: s.loggedAt,
          acted: s.acted,
          outcome: s.outcome,
        })),
        stats: getTrader().getPerformanceStats(),
      };

      console.log(JSON.stringify(result, null, options.pretty ? 2 : 0));
    } catch (error: any) {
      console.log(JSON.stringify({ error: error.message }));
      process.exit(1);
    }
  });

// =============================================================================
// Verbose Commands (original)
// =============================================================================

// Smart Money Command
program
  .command('smart-money')
  .description('Track smart money netflow')
  .requiredOption('--chain <chain>', 'Blockchain (ethereum, base, arbitrum, etc.)')
  .option('--token <address>', 'Filter by token address')
  .option('--direction <dir>', 'Filter: inflow, outflow, or all', 'all')
  .option('--min-value <usd>', 'Minimum USD value', parseFloat)
  .option('--timeframe <tf>', 'Timeframe: 1h, 24h, 7d, 30d', '24h')
  .option('--limit <n>', 'Number of results', parseInt, 20)
  .option('--watch', 'Continuous monitoring mode')
  .option('--threshold <usd>', 'Alert threshold for watch mode', parseFloat)
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = ora('Fetching smart money data...').start();

    try {
      const data = await getClient().getSmartMoneyNetflow({
        chain: options.chain as Chain,
        token: options.token,
        direction: options.direction as FlowDirection,
        minValue: options.minValue,
        timeframe: options.timeframe as Timeframe,
        limit: options.limit,
      });

      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (data.length === 0) {
        console.log(chalk.yellow('No smart money activity found matching criteria.'));
        return;
      }

      const table = new Table({
        head: ['Token', 'Symbol', 'Net Flow', 'Buyers', 'Sellers', 'Direction'],
        style: { head: ['cyan'] },
      });

      for (const item of data) {
        const direction = item.netflow > 0
          ? chalk.green('ACCUMULATING')
          : chalk.red('DISTRIBUTING');

        table.push([
          formatAddress(item.token),
          item.symbol,
          `$${formatNumber(item.netflowUsd)}`,
          item.buyersCount.toString(),
          item.sellersCount.toString(),
          direction,
        ]);
      }

      console.log(`\n${chalk.cyan('Smart Money Activity')} - ${options.chain} (${options.timeframe})\n`);
      console.log(table.toString());

    } catch (error: any) {
      spinner.stop();
      handleError(error);
    }
  });

// Token Screener Command
program
  .command('screen')
  .description('Screen tokens with advanced filters')
  .requiredOption('--chain <chain>', 'Blockchain')
  .option('--smart-money-only', 'Only tokens with smart money activity')
  .option('--min-holders <n>', 'Minimum holder count', parseInt)
  .option('--max-holders <n>', 'Maximum holder count', parseInt)
  .option('--min-volume <usd>', 'Minimum 24h volume', parseFloat)
  .option('--max-volume <usd>', 'Maximum 24h volume', parseFloat)
  .option('--min-mcap <usd>', 'Minimum market cap', parseFloat)
  .option('--max-mcap <usd>', 'Maximum market cap', parseFloat)
  .option('--min-netflow <usd>', 'Minimum smart money netflow', parseFloat)
  .option('--sort <field>', 'Sort by: netflow, volume, holders, mcap')
  .option('--limit <n>', 'Number of results', parseInt, 20)
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = ora('Screening tokens...').start();

    try {
      const data = await getClient().screenTokens({
        chain: options.chain as Chain,
        onlySmartMoney: options.smartMoneyOnly,
        minHolders: options.minHolders,
        maxHolders: options.maxHolders,
        minVolume: options.minVolume,
        maxVolume: options.maxVolume,
        minMcap: options.minMcap,
        maxMcap: options.maxMcap,
        minNetflow: options.minNetflow,
        sort: options.sort,
        limit: options.limit,
      });

      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (data.length === 0) {
        console.log(chalk.yellow('No tokens found matching criteria.'));
        return;
      }

      const table = new Table({
        head: ['Symbol', 'Price', '24h %', 'MCap', 'Volume', 'SM Netflow'],
        style: { head: ['cyan'] },
      });

      for (const item of data) {
        const change = item.priceChange24h > 0
          ? chalk.green(`+${item.priceChange24h.toFixed(2)}%`)
          : chalk.red(`${item.priceChange24h.toFixed(2)}%`);

        const netflow = item.smartMoneyNetflow > 0
          ? chalk.green(`+$${formatNumber(item.smartMoneyNetflow)}`)
          : chalk.red(`-$${formatNumber(Math.abs(item.smartMoneyNetflow))}`);

        table.push([
          item.symbol,
          `$${item.price.toFixed(6)}`,
          change,
          `$${formatNumber(item.marketCap)}`,
          `$${formatNumber(item.volume24h)}`,
          netflow,
        ]);
      }

      console.log(`\n${chalk.cyan('Token Screener')} - ${options.chain}\n`);
      console.log(table.toString());

    } catch (error: any) {
      spinner.stop();
      handleError(error);
    }
  });

// DEX Trades Command
program
  .command('dex-trades')
  .description('Monitor DEX trading activity')
  .requiredOption('--chain <chain>', 'Blockchain')
  .option('--token <address>', 'Filter by token')
  .option('--smart-money-only', 'Only smart money trades')
  .option('--dex <name>', 'Filter by DEX (uniswap_v3, aerodrome, etc.)')
  .option('--min-value <usd>', 'Minimum trade value', parseFloat)
  .option('--limit <n>', 'Number of results', parseInt, 20)
  .option('--watch', 'Continuous monitoring mode')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = ora('Fetching DEX trades...').start();

    try {
      const data = await getClient().getDexTrades({
        chain: options.chain as Chain,
        token: options.token,
        onlySmartMoney: options.smartMoneyOnly,
        dex: options.dex,
        minValue: options.minValue,
        limit: options.limit,
      });

      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (data.length === 0) {
        console.log(chalk.yellow('No trades found matching criteria.'));
        return;
      }

      const table = new Table({
        head: ['Time', 'Symbol', 'Side', 'Amount', 'Value', 'DEX', 'Wallet'],
        style: { head: ['cyan'] },
      });

      for (const item of data) {
        const side = item.side === 'buy'
          ? chalk.green('BUY')
          : chalk.red('SELL');

        const time = new Date(item.timestamp).toLocaleTimeString();

        table.push([
          time,
          item.symbol,
          side,
          formatNumber(item.amount),
          `$${formatNumber(item.amountUsd)}`,
          item.dex,
          item.walletLabel || formatAddress(item.wallet),
        ]);
      }

      console.log(`\n${chalk.cyan('DEX Trades')} - ${options.chain}\n`);
      console.log(table.toString());

    } catch (error: any) {
      spinner.stop();
      handleError(error);
    }
  });

// Flows Command
program
  .command('flows')
  .description('Track token flows by wallet category')
  .requiredOption('--chain <chain>', 'Blockchain')
  .option('--token <address>', 'Filter by token')
  .option('--label <label>', 'Wallet label (smart_money, whale, exchange)')
  .option('--labels <list>', 'Multiple labels (comma-separated)')
  .option('--direction <dir>', 'Filter: inflow, outflow, or all', 'all')
  .option('--timeframe <tf>', 'Timeframe: 1h, 24h, 7d, 30d', '24h')
  .option('--limit <n>', 'Number of results', parseInt, 20)
  .option('--watch', 'Continuous monitoring mode')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = ora('Fetching flow data...').start();

    try {
      let labels: WalletLabel[] = [];
      if (options.labels) {
        labels = options.labels.split(',').map((l: string) => l.trim() as WalletLabel);
      } else if (options.label) {
        labels = [options.label as WalletLabel];
      } else {
        labels = ['smart_money'];
      }

      const data = await getClient().getFlows({
        chain: options.chain as Chain,
        token: options.token,
        labels,
        direction: options.direction as FlowDirection,
        timeframe: options.timeframe as Timeframe,
        limit: options.limit,
      });

      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (data.length === 0) {
        console.log(chalk.yellow('No flows found matching criteria.'));
        return;
      }

      const table = new Table({
        head: ['Token', 'Label', 'Direction', 'Amount', 'Wallets', 'Txs'],
        style: { head: ['cyan'] },
      });

      for (const item of data) {
        const direction = item.direction === 'inflow'
          ? chalk.green('INFLOW')
          : chalk.red('OUTFLOW');

        table.push([
          item.symbol,
          item.label,
          direction,
          `$${formatNumber(item.amountUsd)}`,
          item.uniqueWallets.toString(),
          item.txCount.toString(),
        ]);
      }

      console.log(`\n${chalk.cyan('Token Flows')} - ${options.chain} (${options.timeframe})\n`);
      console.log(table.toString());

    } catch (error: any) {
      spinner.stop();
      handleError(error);
    }
  });

// Wallet Profile Command
program
  .command('profile')
  .description('Analyze a wallet')
  .requiredOption('--address <addr>', 'Wallet address')
  .option('--trades', 'Include trading history')
  .option('--holdings', 'Include current holdings')
  .option('--labels-only', 'Only show wallet labels')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = ora('Fetching wallet profile...').start();

    try {
      if (options.labelsOnly) {
        const labels = await getClient().getWalletLabels(options.address);
        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify({ address: options.address, labels }, null, 2));
        } else if (labels.length === 0) {
          console.log(chalk.yellow(`No labels found for ${options.address}`));
        } else {
          console.log(`\n${chalk.cyan('Wallet Labels')}: ${labels.join(', ')}`);
        }
        return;
      }

      const profile = await getClient().getWalletProfile({ address: options.address });
      spinner.stop();

      if (options.json) {
        const result: any = { profile };
        if (options.holdings) {
          result.holdings = await getClient().getWalletHoldings(options.address);
        }
        if (options.trades) {
          result.trades = await getClient().getWalletTrades(options.address);
        }
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`\n${chalk.cyan('Wallet Profile')}\n`);
      console.log(`Address: ${profile.address}`);
      console.log(`Labels: ${profile.labels.length > 0 ? profile.labels.join(', ') : 'None'}`);
      console.log(`Total Value: $${formatNumber(profile.totalValue)}`);
      console.log(`Realized PnL: $${formatNumber(profile.realizedPnl)}`);
      console.log(`Win Rate: ${(profile.winRate * 100).toFixed(1)}%`);
      console.log(`Total Trades: ${profile.tradesCount}`);
      console.log(`First Seen: ${profile.firstSeen}`);
      console.log(`Last Active: ${profile.lastActive}`);

      if (options.holdings) {
        const holdings = await getClient().getWalletHoldings(options.address);
        if (holdings.length > 0) {
          console.log(`\n${chalk.cyan('Holdings')}\n`);
          const table = new Table({
            head: ['Token', 'Chain', 'Balance', 'Value', 'PnL'],
            style: { head: ['cyan'] },
          });
          for (const h of holdings) {
            const pnl = h.pnl > 0
              ? chalk.green(`+$${formatNumber(h.pnl)}`)
              : chalk.red(`-$${formatNumber(Math.abs(h.pnl))}`);
            table.push([h.symbol, h.chain, formatNumber(h.balance), `$${formatNumber(h.value)}`, pnl]);
          }
          console.log(table.toString());
        }
      }

      if (options.trades) {
        const trades = await getClient().getWalletTrades(options.address);
        if (trades.length > 0) {
          console.log(`\n${chalk.cyan('Recent Trades')}\n`);
          const table = new Table({
            head: ['Time', 'Token', 'Side', 'Amount', 'Value'],
            style: { head: ['cyan'] },
          });
          for (const t of trades.slice(0, 10)) {
            const side = t.side === 'buy' ? chalk.green('BUY') : chalk.red('SELL');
            const time = new Date(t.timestamp).toLocaleString();
            table.push([time, t.symbol, side, formatNumber(t.amount), `$${formatNumber(t.amountUsd)}`]);
          }
          console.log(table.toString());
        }
      }

    } catch (error: any) {
      spinner.stop();
      handleError(error);
    }
  });

// Token Analysis Command (verbose)
program
  .command('token-detail')
  .description('Detailed token analysis with holder breakdown')
  .requiredOption('--address <addr>', 'Token address')
  .requiredOption('--chain <chain>', 'Blockchain')
  .option('--holders', 'Include holder breakdown')
  .option('--smart-money-holders', 'Show smart money holders')
  .option('--holder-changes', 'Show holder changes over time')
  .option('--timeframe <tf>', 'Timeframe for changes: 1h, 24h, 7d', '24h')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = ora('Analyzing token...').start();

    try {
      const info = await getClient().getTokenInfo({
        address: options.address,
        chain: options.chain as Chain,
      });

      spinner.stop();

      if (options.json) {
        const result: any = { info };
        if (options.holders) {
          result.holders = await getClient().getTokenHolders(options.address, options.chain);
        }
        if (options.smartMoneyHolders) {
          result.smartMoneyHolders = await getClient().getSmartMoneyHolders(options.address, options.chain);
        }
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`\n${chalk.cyan('Token Info')}\n`);
      console.log(`Name: ${info.name} (${info.symbol})`);
      console.log(`Address: ${info.address}`);
      console.log(`Chain: ${info.chain}`);
      console.log(`Price: $${info.price.toFixed(8)}`);
      console.log(`Market Cap: $${formatNumber(info.marketCap)}`);
      console.log(`24h Volume: $${formatNumber(info.volume24h)}`);
      console.log(`Liquidity: $${formatNumber(info.liquidity)}`);
      console.log(`Holders: ${formatNumber(info.holders)}`);

      if (options.holders) {
        const holders = await getClient().getTokenHolders(options.address, options.chain);
        if (holders.length > 0) {
          console.log(`\n${chalk.cyan('Holder Breakdown')}\n`);
          const table = new Table({
            head: ['Category', 'Count', 'Percentage', 'Value'],
            style: { head: ['cyan'] },
          });
          for (const h of holders) {
            table.push([h.label, h.count.toString(), `${h.percentage.toFixed(1)}%`, `$${formatNumber(h.totalValue)}`]);
          }
          console.log(table.toString());
        }
      }

      if (options.smartMoneyHolders) {
        const smHolders = await getClient().getSmartMoneyHolders(options.address, options.chain);
        if (smHolders.length > 0) {
          console.log(`\n${chalk.cyan('Smart Money Holders')}\n`);
          const table = new Table({
            head: ['Address', 'Value', 'PnL', 'Win Rate'],
            style: { head: ['cyan'] },
          });
          for (const h of smHolders.slice(0, 10)) {
            const pnl = h.realizedPnl > 0
              ? chalk.green(`+$${formatNumber(h.realizedPnl)}`)
              : chalk.red(`-$${formatNumber(Math.abs(h.realizedPnl))}`);
            table.push([
              formatAddress(h.address),
              `$${formatNumber(h.totalValue)}`,
              pnl,
              `${(h.winRate * 100).toFixed(1)}%`,
            ]);
          }
          console.log(table.toString());
        }
      }

    } catch (error: any) {
      spinner.stop();
      handleError(error);
    }
  });

// Opportunity Scanner Command
program
  .command('scan')
  .description('Scan for trading opportunities')
  .requiredOption('--chain <chain>', 'Blockchain')
  .option('--mode <mode>', 'Scan mode: accumulation, distribution, breakout, fresh-wallets', 'accumulation')
  .option('--limit <n>', 'Number of results', parseInt, 10)
  .option('--watch', 'Continuous monitoring mode')
  .option('--interval <sec>', 'Watch interval in seconds', parseInt, 60)
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const runScan = async () => {
      const spinner = ora(`Scanning for ${options.mode} signals...`).start();

      try {
        const signals = await getClient().scanOpportunities({
          chain: options.chain as Chain,
          mode: options.mode as ScanMode,
          limit: options.limit,
        });

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify(signals, null, 2));
          return signals;
        }

        if (signals.length === 0) {
          console.log(chalk.yellow(`No ${options.mode} signals found.`));
          return signals;
        }

        console.log(`\n${chalk.cyan(`Opportunity Scan: ${options.mode.toUpperCase()}`)} - ${options.chain}\n`);

        const table = new Table({
          head: ['Score', 'Token', 'Reason'],
          style: { head: ['cyan'] },
          colWidths: [8, 12, 60],
          wordWrap: true,
        });

        for (const signal of signals) {
          const scoreColor = signal.score > 5 ? chalk.green : signal.score > 2 ? chalk.yellow : chalk.white;
          table.push([
            scoreColor(signal.score.toFixed(2)),
            signal.symbol,
            signal.reason,
          ]);
        }

        console.log(table.toString());
        return signals;

      } catch (error: any) {
        spinner.stop();
        handleError(error);
      }
    };

    if (options.watch) {
      console.log(chalk.cyan(`Watching for ${options.mode} signals every ${options.interval}s...\n`));
      console.log('Press Ctrl+C to stop\n');

      await runScan();

      setInterval(async () => {
        console.log(`\n--- ${new Date().toLocaleTimeString()} ---\n`);
        await runScan();
      }, options.interval * 1000);
    } else {
      await runScan();
    }
  });

// Chains Command
program
  .command('chains')
  .description('List supported chains')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = ora('Fetching supported chains...').start();

    try {
      const chains = await getClient().getSupportedChains();
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(chains, null, 2));
        return;
      }

      console.log(`\n${chalk.cyan('Supported Chains')}\n`);
      for (const chain of chains) {
        console.log(`  - ${chain}`);
      }

    } catch (error: any) {
      spinner.stop();
      handleError(error);
    }
  });

// =============================================================================
// MCP Commands (AI-Powered)
// =============================================================================

let mcp: NansenMcp;

function getMcp(): NansenMcp {
  if (!mcp) {
    const apiKey = process.env.NANSEN_API_KEY;
    if (!apiKey) {
      console.error(chalk.red('NANSEN_API_KEY not found'));
      console.log('\nSet your API key:');
      console.log('  export NANSEN_API_KEY=your_key_here');
      process.exit(1);
    }
    mcp = new NansenMcp(apiKey);
  }
  return mcp;
}

const mcpCmd = program.command('mcp').description('MCP commands (AI-powered, 21 tools)');

mcpCmd
  .command('tool')
  .description('Call an MCP tool directly')
  .requiredOption('--name <tool>', 'Tool name')
  .requiredOption('--params <json>', 'Parameters as JSON')
  .action(async (options) => {
    const spinner = ora(`Calling MCP tool: ${options.name}...`).start();
    try {
      const params = JSON.parse(options.params);
      const result = await getMcp().callTool(options.name as McpTool, params);
      spinner.stop();
      console.log(JSON.stringify(result, null, 2));
    } catch (error: any) {
      spinner.stop();
      if (error instanceof NansenMcpError) {
        console.error(chalk.red(`MCP Error: ${error.message}`));
      } else {
        console.error(chalk.red(`Error: ${error.message}`));
      }
      process.exit(1);
    }
  });

mcpCmd
  .command('analyze-token')
  .description('Analyze a token using multiple MCP tools')
  .requiredOption('--token <address>', 'Token address')
  .requiredOption('--chain <chain>', 'Blockchain')
  .action(async (options) => {
    const spinner = ora(`Analyzing token...`).start();
    try {
      const result = await getMcp().analyzeToken(options.token, options.chain as Chain);
      spinner.stop();
      console.log(JSON.stringify(result, null, 2));
    } catch (error: any) {
      spinner.stop();
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

mcpCmd
  .command('analyze-wallet')
  .description('Analyze a wallet using multiple MCP tools')
  .requiredOption('--address <addr>', 'Wallet address')
  .action(async (options) => {
    const spinner = ora(`Analyzing wallet...`).start();
    try {
      const result = await getMcp().analyzeWallet(options.address);
      spinner.stop();
      console.log(JSON.stringify(result, null, 2));
    } catch (error: any) {
      spinner.stop();
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

mcpCmd
  .command('smart-traders')
  .description('Get smart trader balances')
  .requiredOption('--chain <chain>', 'Blockchain')
  .action(async (options) => {
    const spinner = ora('Fetching smart trader data...').start();
    try {
      const result = await getMcp().getSmartTraderBalances(options.chain as Chain);
      spinner.stop();
      console.log(JSON.stringify(result, null, 2));
    } catch (error: any) {
      spinner.stop();
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

mcpCmd
  .command('search')
  .description('Search for tokens, entities, addresses (free)')
  .requiredOption('--query <text>', 'Search query')
  .action(async (options) => {
    const spinner = ora('Searching...').start();
    try {
      const result = await getMcp().search(options.query);
      spinner.stop();
      console.log(JSON.stringify(result, null, 2));
    } catch (error: any) {
      spinner.stop();
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

mcpCmd
  .command('tools')
  .description('List all available MCP tools')
  .action(() => {
    console.log(`\n${chalk.cyan('Available MCP Tools (21 total)')}\n`);

    const categories: Record<string, McpTool[]> = {
      'Smart Money': ['smart_traders_and_funds_token_balances', 'smart_traders_and_funds_netflows', 'smart_traders_and_funds_dcas_solana'],
      'Token Analysis': ['token_current_top_holders', 'token_dex_trades', 'token_transfers', 'token_flows', 'token_pnl_leaderboard', 'token_who_bought_sold', 'token_jup_dca', 'token_recent_flows_summary', 'token_discovery_screener', 'token_ohlcv'],
      'Wallet Profiler': ['address_historical_balances', 'address_related_addresses', 'address_counterparties', 'address_transactions', 'wallet_pnl_for_token', 'wallet_pnl_summary', 'address_transactions_for_token', 'address_portfolio'],
      'Miscellaneous': ['general_search', 'growth_chain_rank', 'transaction_lookup'],
    };

    for (const [category, tools] of Object.entries(categories)) {
      console.log(chalk.yellow(`\n${category}:`));
      for (const tool of tools) {
        const info = MCP_TOOLS[tool];
        console.log(`  ${chalk.cyan(tool)} (${info.credits} credits)`);
        console.log(`    ${chalk.dim(info.description)}`);
      }
    }
  });

// =============================================================================
// Combined Commands (API + MCP)
// =============================================================================

let agent: NansenAgent;

function getAgent(): NansenAgent {
  if (!agent) {
    try {
      agent = new NansenAgent();
    } catch (error: any) {
      console.error(chalk.red(error.message));
      console.log('\nSet your API key:');
      console.log('  export NANSEN_API_KEY=your_key_here');
      process.exit(1);
    }
  }
  return agent;
}

program
  .command('find')
  .description('Find opportunities (API scan + optional MCP analysis)')
  .option('--chains <list>', 'Comma-separated chains', 'ethereum,base,arbitrum')
  .option('--modes <list>', 'Comma-separated modes', 'accumulation')
  .option('--limit <n>', 'Results per chain/mode', parseInt, 10)
  .option('--analyze <n>', 'Analyze top N with MCP', parseInt, 0)
  .option('--min-score <n>', 'Minimum signal score', parseFloat, 1)
  .option('--json', 'Output JSON')
  .action(async (options) => {
    const chains = options.chains.split(',') as Chain[];
    const modes = options.modes.split(',') as ScanMode[];

    const spinner = ora('Finding opportunities...').start();
    try {
      const result = await getAgent().findOpportunities({
        chains,
        modes,
        limit: options.limit,
        analyzeTop: options.analyze,
        minScore: options.minScore,
      });
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`\n${chalk.cyan('Opportunities Found')}: ${result.allSignals.length}\n`);

      for (const s of result.topSignals.slice(0, options.limit)) {
        const scoreColor = s.score > 5 ? chalk.green : s.score > 2 ? chalk.yellow : chalk.white;
        console.log(`${scoreColor(`[${s.score.toFixed(1)}]`)} ${chalk.cyan(s.symbol)} on ${s.chain}`);
        console.log(`  Type: ${s.type} | ${s.reason}`);
        if ((s as any).mcpAnalysis) {
          console.log(`  ${chalk.dim('MCP: Data collected')}`);
        }
        console.log('');
      }
    } catch (error: any) {
      spinner.stop();
      handleError(error);
    }
  });

program
  .command('watch')
  .description('Monitor for signals in real-time')
  .option('--chains <list>', 'Comma-separated chains', 'ethereum,base')
  .option('--modes <list>', 'Comma-separated modes', 'accumulation')
  .option('--threshold <usd>', 'Minimum USD value', parseFloat, 50000)
  .option('--interval <sec>', 'Scan interval in seconds', parseInt, 60)
  .option('--webhook <url>', 'Webhook URL for alerts')
  .option('--json', 'Output signals as JSON')
  .action(async (options) => {
    const chains = options.chains.split(',') as Chain[];
    const modes = options.modes.split(',') as ScanMode[];

    console.log(chalk.cyan('\nNansen Signal Monitor'));
    console.log(`  Chains: ${chains.join(', ')}`);
    console.log(`  Modes: ${modes.join(', ')}`);
    console.log(`  Threshold: $${formatNumber(options.threshold)}`);
    console.log(`  Interval: ${options.interval}s`);
    if (options.webhook) console.log(`  Webhook: ${options.webhook}`);
    console.log('\nPress Ctrl+C to stop\n');

    const watchOptions = {
      chains,
      modes,
      threshold: options.threshold,
      interval: options.interval * 1000,
    };

    if (options.webhook) {
      getAgent().watchWithWebhook({ ...watchOptions, webhook: options.webhook });
    } else {
      getAgent().watch(watchOptions, (signal) => {
        if (options.json) {
          console.log(JSON.stringify(signal));
        } else {
          const time = new Date().toLocaleTimeString();
          console.log(`[${time}] ${chalk.cyan(signal.symbol)} on ${signal.chain}: ${signal.reason}`);
        }
      });
    }
  });

// =============================================================================
// Trader Commands (Trading Intelligence Layer)
// =============================================================================

let trader: NansenTrader;

function getTrader(): NansenTrader {
  if (!trader) {
    try {
      trader = new NansenTrader();
    } catch (error: any) {
      console.error(chalk.red(error.message));
      console.log('\nSet your API key:');
      console.log('  export NANSEN_API_KEY=your_key_here');
      process.exit(1);
    }
  }
  return trader;
}

function formatSignal(signal: TradingSignal): void {
  const recColors: Record<string, any> = {
    strong_buy: chalk.green.bold,
    buy: chalk.green,
    watch: chalk.yellow,
    avoid: chalk.red,
  };
  const color = recColors[signal.recommendation] || chalk.white;

  console.log(`\n${color(`[${signal.recommendation.toUpperCase()}]`)} ${chalk.cyan(signal.symbol)} on ${signal.chain}`);
  console.log(`  Score: ${signal.score.toFixed(1)} | Risk: ${signal.riskScore} | Confidence: ${(signal.confidence * 100).toFixed(0)}%`);
  console.log(`  ${chalk.dim(signal.reason)}`);

  if (signal.riskFactors.length > 0) {
    console.log(`  Factors: ${signal.riskFactors.join(', ')}`);
  }

  if (signal.suggestedAction) {
    const urgencyColor = signal.suggestedAction.urgency === 'high' ? chalk.red : chalk.yellow;
    console.log(`  ${urgencyColor(`Action: ${signal.suggestedAction.action.toUpperCase()}`)} (${signal.suggestedAction.urgency} urgency)`);
    console.log(`  Position: ${signal.suggestedAction.positionSizeHint}`);
  }
}

const traderCmd = program.command('trader').description('Trading intelligence layer with caching, rate limiting, and risk filtering');

traderCmd
  .command('scan')
  .description('Scan for trading opportunities with risk filtering')
  .option('--chains <list>', 'Comma-separated chains', 'ethereum,base,arbitrum')
  .option('--modes <list>', 'Comma-separated modes', 'accumulation')
  .option('--limit <n>', 'Max signals to return', parseInt, 10)
  .option('--analyze', 'Include MCP analysis for top signals')
  .option('--min-score <n>', 'Minimum signal score', parseFloat, 2)
  .option('--json', 'Output JSON')
  .action(async (options) => {
    const chains = options.chains.split(',') as Chain[];
    const modes = options.modes.split(',') as ScanMode[];

    const spinner = ora('Scanning with risk filters...').start();
    try {
      const signals = await getTrader().scan({
        chains,
        modes,
        limit: options.limit,
        analyze: options.analyze,
        riskOverride: { minScore: options.minScore },
      });
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(signals, null, 2));
        return;
      }

      if (signals.length === 0) {
        console.log(chalk.yellow('\nNo signals passed risk filters.'));
        return;
      }

      console.log(`\n${chalk.cyan('Trading Signals')} (${signals.length} found)\n`);
      for (const signal of signals) {
        formatSignal(signal);
      }
    } catch (error: any) {
      spinner.stop();
      handleError(error);
    }
  });

traderCmd
  .command('quick')
  .description('Quick scan on a single chain')
  .requiredOption('--chain <chain>', 'Blockchain to scan')
  .option('--mode <mode>', 'Scan mode', 'accumulation')
  .option('--json', 'Output JSON')
  .action(async (options) => {
    const spinner = ora(`Quick scan: ${options.chain}...`).start();
    try {
      const signals = await getTrader().quickScan(options.chain as Chain, options.mode as ScanMode);
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(signals, null, 2));
        return;
      }

      if (signals.length === 0) {
        console.log(chalk.yellow('\nNo signals found.'));
        return;
      }

      for (const signal of signals) {
        formatSignal(signal);
      }
    } catch (error: any) {
      spinner.stop();
      handleError(error);
    }
  });

traderCmd
  .command('deep')
  .description('Deep scan with MCP analysis')
  .option('--chains <list>', 'Comma-separated chains', 'ethereum,base')
  .option('--modes <list>', 'Comma-separated modes', 'accumulation')
  .option('--limit <n>', 'Max signals', parseInt, 5)
  .option('--json', 'Output JSON')
  .action(async (options) => {
    const chains = options.chains.split(',') as Chain[];
    const modes = options.modes.split(',') as ScanMode[];

    const spinner = ora('Deep scan with MCP analysis...').start();
    try {
      const signals = await getTrader().deepScan({ chains, modes, limit: options.limit });
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(signals, null, 2));
        return;
      }

      if (signals.length === 0) {
        console.log(chalk.yellow('\nNo signals found.'));
        return;
      }

      for (const signal of signals) {
        formatSignal(signal);
        if ((signal as any).mcpAnalysis) {
          console.log(`  ${chalk.dim('MCP analysis available')}`);
        }
      }
    } catch (error: any) {
      spinner.stop();
      handleError(error);
    }
  });

traderCmd
  .command('monitor')
  .description('Continuous monitoring with callbacks')
  .option('--chains <list>', 'Comma-separated chains', 'ethereum,base')
  .option('--modes <list>', 'Comma-separated modes', 'accumulation')
  .option('--interval <sec>', 'Scan interval in seconds', parseInt, 60)
  .option('--min-score <n>', 'Minimum signal score', parseFloat, 3)
  .option('--json', 'Output signals as JSON')
  .action(async (options) => {
    const chains = options.chains.split(',') as Chain[];
    const modes = options.modes.split(',') as ScanMode[];

    console.log(chalk.cyan('\nTrader Monitor'));
    console.log(`  Chains: ${chains.join(', ')}`);
    console.log(`  Modes: ${modes.join(', ')}`);
    console.log(`  Interval: ${options.interval}s`);
    console.log(`  Min Score: ${options.minScore}`);
    console.log('\nPress Ctrl+C to stop\n');

    getTrader().monitor(
      {
        chains,
        modes,
        intervalMs: options.interval * 1000,
        riskOverride: { minScore: options.minScore },
      },
      (signal) => {
        if (options.json) {
          console.log(JSON.stringify(signal));
        } else {
          formatSignal(signal);
        }
      }
    );
  });

traderCmd
  .command('analyze')
  .description('Analyze a specific token')
  .requiredOption('--token <address>', 'Token address')
  .requiredOption('--chain <chain>', 'Blockchain')
  .option('--json', 'Output JSON')
  .action(async (options) => {
    const spinner = ora('Analyzing token...').start();
    try {
      const result = await getTrader().analyzeToken(options.token, options.chain as Chain);
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const recColor = result.recommendation === 'buy' ? chalk.green :
                       result.recommendation === 'avoid' ? chalk.red : chalk.yellow;

      console.log(`\n${chalk.cyan('Token Analysis')}\n`);
      console.log(`Recommendation: ${recColor(result.recommendation.toUpperCase())}`);
      console.log(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);
      console.log(`Reasoning: ${result.reasoning}`);

      if (result.apiData) {
        console.log(`\n${chalk.dim('API Data:')}`);
        console.log(`  Price: $${result.apiData.price.toFixed(6)}`);
        console.log(`  Market Cap: $${formatNumber(result.apiData.marketCap)}`);
        console.log(`  Volume 24h: $${formatNumber(result.apiData.volume24h)}`);
        console.log(`  Holders: ${formatNumber(result.apiData.holders)}`);
        console.log(`  Liquidity: $${formatNumber(result.apiData.liquidity)}`);
      }

      if (result.mcpData) {
        console.log(`\n${chalk.dim('MCP Data: Available')}`);
      }
    } catch (error: any) {
      spinner.stop();
      handleError(error);
    }
  });

traderCmd
  .command('signals')
  .description('View logged signals')
  .option('--limit <n>', 'Number of signals', parseInt, 20)
  .option('--token <address>', 'Filter by token')
  .option('--chain <chain>', 'Filter by chain')
  .option('--acted', 'Only show acted signals')
  .option('--json', 'Output JSON')
  .action(async (options) => {
    let signals;

    if (options.token) {
      signals = getTrader().getTokenSignals(options.token, options.chain as Chain | undefined);
    } else {
      signals = getTrader().getRecentSignals(options.limit);
    }

    if (options.acted) {
      signals = signals.filter(s => s.acted);
    }

    if (options.json) {
      console.log(JSON.stringify(signals, null, 2));
      return;
    }

    if (signals.length === 0) {
      console.log(chalk.yellow('\nNo signals found.'));
      return;
    }

    console.log(`\n${chalk.cyan('Logged Signals')} (${signals.length})\n`);

    const table = new Table({
      head: ['ID', 'Token', 'Chain', 'Score', 'Acted', 'Logged'],
      style: { head: ['cyan'] },
    });

    for (const s of signals) {
      table.push([
        s.id.slice(0, 20) + '...',
        s.symbol,
        s.chain,
        s.score.toFixed(1),
        s.acted ? chalk.green('Yes') : chalk.dim('No'),
        new Date(s.loggedAt).toLocaleString(),
      ]);
    }

    console.log(table.toString());
  });

traderCmd
  .command('mark')
  .description('Mark a signal as acted upon')
  .requiredOption('--id <signalId>', 'Signal ID')
  .requiredOption('--action <action>', 'Action taken: buy, sell, skip')
  .option('--notes <text>', 'Optional notes')
  .action(async (options) => {
    const result = getTrader().markActed(options.id, options.action, options.notes);

    if (!result) {
      console.log(chalk.red(`Signal not found: ${options.id}`));
      process.exit(1);
    }

    console.log(chalk.green(`\nMarked signal as ${options.action}`));
    console.log(`ID: ${result.id}`);
    console.log(`Token: ${result.symbol} on ${result.chain}`);
  });

traderCmd
  .command('outcome')
  .description('Record outcome for a signal')
  .requiredOption('--id <signalId>', 'Signal ID')
  .option('--entry <price>', 'Entry price', parseFloat)
  .option('--exit <price>', 'Exit price', parseFloat)
  .option('--pnl <amount>', 'PnL in USD', parseFloat)
  .option('--notes <text>', 'Notes')
  .action(async (options) => {
    const outcome: any = {};
    if (options.entry) outcome.entryPrice = options.entry;
    if (options.exit) outcome.exitPrice = options.exit;
    if (options.pnl) outcome.pnl = options.pnl;
    if (options.notes) outcome.notes = options.notes;

    const result = getTrader().recordOutcome(options.id, outcome);

    if (!result) {
      console.log(chalk.red(`Signal not found: ${options.id}`));
      process.exit(1);
    }

    console.log(chalk.green('\nOutcome recorded'));
    if (result.outcome?.pnlPercent !== undefined) {
      const pnlColor = result.outcome.pnlPercent > 0 ? chalk.green : chalk.red;
      console.log(`PnL: ${pnlColor(`${result.outcome.pnlPercent > 0 ? '+' : ''}${result.outcome.pnlPercent.toFixed(2)}%`)}`);
    }
  });

traderCmd
  .command('stats')
  .description('View trader statistics')
  .option('--json', 'Output JSON')
  .action(async (options) => {
    const stats = getTrader().getStats();
    const perfStats = getTrader().getPerformanceStats();

    if (options.json) {
      console.log(JSON.stringify({ stats, performance: perfStats }, null, 2));
      return;
    }

    console.log(`\n${chalk.cyan('Trader Statistics')}\n`);

    console.log(chalk.yellow('Cache:'));
    console.log(`  Hits: ${stats.cache.hits}`);
    console.log(`  Misses: ${stats.cache.misses}`);
    console.log(`  Credits Saved: ${stats.cache.creditsSaved}`);

    console.log(chalk.yellow('\nRate Limiter:'));
    console.log(`  Total Requests: ${stats.rateLimit.totalRequests}`);
    console.log(`  Throttled: ${stats.rateLimit.throttledRequests}`);
    console.log(`  Wait Time: ${stats.rateLimit.totalWaitTimeMs}ms`);

    console.log(chalk.yellow('\nSignals:'));
    console.log(`  Total: ${stats.signals.totalSignals}`);
    console.log(`  Acted On: ${stats.signals.actedOn}`);
    console.log(`  Win Rate: ${(stats.signals.winRate * 100).toFixed(1)}%`);
    console.log(`  Total PnL: $${formatNumber(stats.signals.totalPnl)}`);

    console.log(chalk.yellow('\nBy Chain:'));
    for (const [chain, count] of Object.entries(perfStats.byChain)) {
      console.log(`  ${chain}: ${count}`);
    }

    console.log(chalk.yellow('\nBy Mode:'));
    for (const [mode, count] of Object.entries(perfStats.byMode)) {
      console.log(`  ${mode}: ${count}`);
    }
  });

program.parse();
