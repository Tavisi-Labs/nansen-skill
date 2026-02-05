# Nansen Trading Skill

Trading-focused Nansen integration for autonomous agents. **MCP-first architecture** with API fallback for comprehensive smart money tracking, token screening, and opportunity detection.

## Features

- **NansenData**: Unified data layer (MCP-first with API fallback)
  - `getMarketOverview()` - Single call for market-wide view
  - `getPolymarketOverview()` - Polymarket/Polygon focused data
  - Smart routing between MCP (21 tools) and Direct API (10 endpoints)
  - Parallel fetching for efficiency

- **NansenTrader**: High-level trading intelligence layer
  - Caching to save API credits
  - Token bucket rate limiting
  - Signal logging with performance tracking
  - Risk filtering and recommendations

- **Direct API**: Fast access to Nansen endpoints (10 working)
  - Smart money: netflow, holdings, dex-trades
  - Token God Mode: holders, flows, dex-trades, transfers, who-bought-sold
  - Wallet Profiler: current-balance, related-wallets

- **MCP**: 21 AI-powered analysis tools (via HTTP, no subprocess)
  - Token analysis (holders, trades, flows, PnL, screener, OHLCV)
  - Wallet profiling (portfolio, PnL, transactions, counterparties)
  - Search (free!), chain rankings, transaction lookup

## Installation

```bash
npm install
npm run build
export NANSEN_API_KEY=your_key_here
```

Get your API key at: https://app.nansen.ai/api

## Quick Start

### CLI (JSON-first)

```bash
# Market overview (single call, parallel fetch)
nansen market                             # Overview: base, ethereum, arbitrum, polygon
nansen market -c base,solana --pretty     # Custom chains
nansen market -k 5                        # Include OHLCV for top 5 tokens (+5 credits)
nansen market -k 3 --interval 4h          # Top 3 with 4h OHLCV
nansen polymarket                         # Polymarket/Polygon focused
nansen polymarket --analyze-contracts     # Include contract analysis

# Token commands (MCP-first)
nansen hot base                           # Top tokens by smart money on Base
nansen hot ethereum -l 20                 # Top 20 on Ethereum
nansen token 0x... -c base                # Token summary (holders, flows, trades)
nansen holders --token 0x... --chain base # Token holders

# Wallet commands (MCP-first)
nansen address 0x...                      # Wallet summary with PnL
nansen balances --address 0x... --chain ethereum

# Smart money (API-first, faster for bulk)
nansen smart-money --chain base --json
nansen holdings --chain base
nansen sm-trades --chain base

# MCP tools (21 available)
nansen mcp search --query "AERO base"     # Free search
nansen mcp wallet-pnl --address 0x...     # Wallet PnL summary
nansen mcp ohlcv --token 0x... --chain base
nansen mcp tools                          # List all tools

# Trading intelligence
nansen trader quick --chain base
nansen alerts                             # Recent signals
```

### Example Output

```bash
$ nansen hot base -l 3
{"chain":"base","timeframe":"24h","timestamp":"2024-...","hotTokens":[{"token":"0x...","symbol":"VIRTUAL","netflowUsd":2500000,"buyers":45,"sellers":12,"signal":"strong_accumulation"},...],"topScreened":[...]}

$ nansen token 0x... -c base --pretty
{
  "token": "0x...",
  "chain": "base",
  "info": { "symbol": "VIRTUAL", "price": 1.23, ... },
  "smartMoneyFlow": { "netflowUsd": 500000, "buyers": 23, "signal": "accumulation" },
  "notableWallets": [...]
}

$ nansen alerts --min-score 5
{"timestamp":"...","count":3,"alerts":[{"symbol":"AERO","chain":"base","score":7.2,"reason":"Strong accumulation",...}],"stats":{...}}
```

### Programmatic

```typescript
// Unified data layer (recommended)
import { createData } from 'nansen-api-skill';

const data = createData();

// Single call for market overview (parallel fetch)
const market = await data.getMarketOverview({
  chains: ['base', 'ethereum', 'polygon'],
  topOhlcvCount: 5,  // Fetch OHLCV for top 5 tokens (5 credits)
  ohlcvInterval: '1h',
});
console.log(`Hot tokens: ${market.hotTokens.length}`);
console.log(`Top accumulating: ${market.smartMoneyActivity.topAccumulating.map(t => t.symbol)}`);
console.log(`Volatility: ${market.topTokensOhlcv?.map(t => `${t.symbol}: ${t.volatility}%`)}`);

// Polymarket-focused overview
const polymarket = await data.getPolymarketOverview(true); // true = analyze contracts
console.log(`Polygon activity: ${polymarket.polygonActivity.hotTokens.length} tokens`);

// Individual queries (MCP-first with API fallback)
const tokenInfo = await data.getTokenInfo('0x...', 'base');
const walletProfile = await data.getWalletProfile('0x...');
const searchResults = await data.search('AERO base'); // Free!

// Trading intelligence layer
import { createTrader } from 'nansen-api-skill';

const trader = createTrader({
  rateLimitPreset: 'standard',
  riskConfig: { minScore: 2.5, minSmartMoneyBuyers: 5 },
});

const signals = await trader.scan({
  chains: ['ethereum', 'base'],
  modes: ['accumulation'],
  analyze: true,
});

for (const signal of signals) {
  console.log(`${signal.recommendation}: ${signal.symbol}`);
  if (signal.suggestedAction) {
    console.log(`  Action: ${signal.suggestedAction.action}`);
  }
}

// Track performance
trader.markActed(signal.id, 'buy');
trader.recordOutcome(signal.id, { entryPrice: 1.0, exitPrice: 1.5 });
console.log(`Win rate: ${trader.getStats().signals.winRate}`);
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    NansenTrader                         │
│  ┌─────────┐  ┌─────────────┐  ┌──────────────────┐    │
│  │  Cache  │  │ RateLimiter │  │    SignalLog     │    │
│  └─────────┘  └─────────────┘  └──────────────────┘    │
│                        │                                │
│              ┌─────────┴─────────┐                     │
│              │    NansenAgent    │                     │
│              └─────────┬─────────┘                     │
│                        │                                │
│              ┌─────────┴─────────┐                     │
│              │    NansenData     │  ← Unified Layer    │
│              │  (MCP-first)      │                     │
│              └─────────┬─────────┘                     │
│         ┌──────────────┴──────────────┐                │
│         │                             │                │
│  ┌──────┴──────┐            ┌────────┴────────┐       │
│  │ NansenClient│            │    NansenMcp    │       │
│  │ (10 endpoints)           │  (21 tools)     │       │
│  │  API-first  │            │  MCP-first      │       │
│  └─────────────┘            └─────────────────┘       │
└─────────────────────────────────────────────────────────┘
                           │
           ┌───────────────┴───────────────┐
           │                               │
    ┌──────┴──────┐              ┌────────┴────────┐
    │ Direct API  │              │   MCP HTTP      │
    │ api.nansen  │              │  mcp.nansen     │
    └─────────────┘              └─────────────────┘
```

### Data Routing Strategy

| Request Type | Primary | Fallback | Notes |
|--------------|---------|----------|-------|
| Market overview | Both (parallel) | - | `getMarketOverview()` |
| Token screening | MCP | None | `token_discovery_screener` |
| Token holders | MCP | API | Richer data from MCP |
| Token trades | MCP | API | Smart money filter |
| Wallet profile | MCP | API | Includes PnL |
| Smart money netflow | API | MCP | Faster for bulk |
| Search | MCP | None | Free, no credits! |

## Signal Output

Each trading signal includes:

```typescript
{
  id: string;
  token: string;
  symbol: string;
  chain: Chain;
  score: number;
  reason: string;

  // Trading intelligence
  recommendation: 'strong_buy' | 'buy' | 'watch' | 'avoid';
  confidence: number;        // 0-1
  riskScore: number;
  riskFactors: string[];

  // Suggested action
  suggestedAction?: {
    action: 'buy' | 'sell' | 'wait';
    urgency: 'high' | 'medium' | 'low';
    reasoning: string;
    positionSizeHint: 'small' | 'medium' | 'large';
  };
}
```

## CLI Commands

### Market Overview (Recommended Entry Points)

| Command | Description |
|---------|-------------|
| `market` | High-level market overview (parallel fetch) |
| `market -c base,solana` | Custom chains |
| `market -k 5` | Include OHLCV/volatility for top 5 tokens (5 credits) |
| `market -k 3 --interval 4h` | OHLCV with 4-hour interval |
| `polymarket` | Polymarket/Polygon focused overview |
| `polymarket --analyze-contracts` | Include CTF contract analysis |

### Token Commands (MCP-first)

| Command | Description |
|---------|-------------|
| `hot <chain>` | Top tokens by smart money flow |
| `token <address> -c <chain>` | Token summary: flows, holders, PnL |
| `holders --token 0x... --chain base` | Token top holders |
| `flows --token 0x... --chain base` | Token flows by entity |
| `trades --token 0x... --chain base` | Token DEX trades |

### Wallet Commands (MCP-first)

| Command | Description |
|---------|-------------|
| `address <addr>` | Wallet summary with PnL |
| `balances --address 0x... --chain eth` | Token balances |
| `related --address 0x...` | Related wallets |

### Smart Money (API-first)

| Command | Description |
|---------|-------------|
| `smart-money --chain base` | Smart money netflow |
| `holdings --chain base` | Smart money holdings |
| `sm-trades --chain base` | Smart money DEX trades |
| `scan --chain base` | Opportunity scanner |

### Trader (Intelligence Layer)

| Command | Description |
|---------|-------------|
| `trader scan` | Scan with risk filtering and recommendations |
| `trader quick` | Fast single-chain scan |
| `trader deep` | Comprehensive scan with MCP analysis |
| `trader monitor` | Continuous monitoring |
| `trader analyze` | Analyze specific token |
| `trader signals` | View logged signals |
| `trader mark` | Mark signal as acted |
| `trader outcome` | Record trade outcome |
| `trader stats` | View statistics |

### Direct API

| Command | Description |
|---------|-------------|
| `smart-money` | Track smart money netflow |
| `screen` | Token screener with filters |
| `dex-trades` | Monitor DEX activity |
| `flows` | Token flows by wallet category |
| `profile` | Wallet analysis |
| `token` | Token analysis |
| `scan` | Opportunity scanner |

### MCP Commands

| Command | Description |
|---------|-------------|
| `mcp search --query "..."` | Search tokens/entities (free!) |
| `mcp wallet-pnl --address 0x...` | Wallet PnL summary |
| `mcp ohlcv --token 0x... --chain base` | Token OHLCV data |
| `mcp counterparties --address 0x...` | Wallet counterparties |
| `mcp chain-rankings` | Chain activity rankings |
| `mcp tool --name <tool> --params '{}'` | Call any tool directly |
| `mcp tools` | List all 21 tools |

## Testing

```bash
npm test
```

101 tests covering:
- `data.test.ts` - Unified data layer, market overview, Polymarket
- `mcp.test.ts` - MCP client, SSE parsing, JSON-RPC
- `api.test.ts` - Direct API client
- `cache.test.ts` - Caching layer
- `rate-limiter.test.ts` - Rate limiting
- `signal-log.test.ts` - Signal persistence

## Integration

Designed to feed signals into execution skills:
- **Bankr**: DeFi execution
- **Polyclaw**: Polymarket trading

```typescript
// Example integration
trader.monitor({ chains: ['base'] }, async (signal) => {
  if (signal.recommendation === 'strong_buy') {
    // Pass to execution skill
    await bankr.swap({
      chain: signal.chain,
      token: signal.token,
      amount: calculatePosition(signal),
    });

    trader.markActed(signal.id, 'buy');
  }
});
```

## License

MIT
