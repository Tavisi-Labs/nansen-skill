# Nansen Trading Skill

Trading-focused Nansen integration for autonomous agents. Provides smart money tracking, token screening, and opportunity detection with built-in caching, rate limiting, and signal persistence.

## Features

- **NansenTrader**: High-level trading intelligence layer
  - Caching to save API credits
  - Token bucket rate limiting
  - Signal logging with performance tracking
  - Risk filtering and recommendations

- **Direct API**: Fast access to Nansen endpoints
  - Smart money netflow
  - Token screener
  - DEX trades
  - Wallet profiling

- **MCP**: 21 AI-powered analysis tools
  - Token analysis (holders, trades, flows, PnL)
  - Wallet profiling (portfolio, transactions, counterparties)
  - Search and discovery

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
# Streamlined commands (recommended)
nansen hot base                           # Top tokens by smart money on Base
nansen hot ethereum -l 20                 # Top 20 on Ethereum
nansen token 0x... -c base                # Token summary
nansen address 0x...                      # Wallet summary
nansen alerts                             # Recent signals

# Trading intelligence
nansen trader scan --chains ethereum,base
nansen trader quick --chain base
nansen trader monitor --chains base --interval 30

# Direct API (verbose)
nansen smart-money --chain ethereum --json
nansen screen --chain base --smart-money-only --json

# MCP tools
nansen mcp analyze-token --token 0x... --chain base
nansen mcp tools
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
import { NansenTrader, createTrader } from 'nansen-api-skill';

const trader = createTrader({
  rateLimitPreset: 'standard',
  riskConfig: {
    minScore: 2.5,
    minSmartMoneyBuyers: 5,
  },
});

// Scan for opportunities
const signals = await trader.scan({
  chains: ['ethereum', 'base'],
  modes: ['accumulation'],
  analyze: true,
});

for (const signal of signals) {
  console.log(`${signal.recommendation}: ${signal.symbol}`);
  console.log(`  Confidence: ${signal.confidence}`);

  if (signal.suggestedAction) {
    console.log(`  Action: ${signal.suggestedAction.action}`);
    console.log(`  Urgency: ${signal.suggestedAction.urgency}`);
  }
}

// Track performance
trader.markActed(signal.id, 'buy');
trader.recordOutcome(signal.id, { entryPrice: 1.0, exitPrice: 1.5 });

// View stats
const stats = trader.getStats();
console.log(`Win rate: ${stats.signals.winRate}`);
console.log(`Credits saved: ${stats.cache.creditsSaved}`);
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
│         ┌──────────────┴──────────────┐                │
│         │                             │                │
│  ┌──────┴──────┐            ┌────────┴────────┐       │
│  │ NansenClient│            │    NansenMcp    │       │
│  │ (Direct API)│            │   (21 tools)    │       │
│  └─────────────┘            └─────────────────┘       │
└─────────────────────────────────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │  Nansen API │
                    └─────────────┘
```

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

### Streamlined (JSON-first)

| Command | Description |
|---------|-------------|
| `hot <chain>` | Top tokens by smart money flow |
| `token <address> -c <chain>` | Token summary: flows, holders, notable wallets |
| `address <addr>` | Wallet summary: labels, behavior, holdings |
| `alerts` | Recent trading signals from log |

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

### MCP

| Command | Description |
|---------|-------------|
| `mcp tool` | Call any MCP tool directly |
| `mcp analyze-token` | Comprehensive token analysis |
| `mcp analyze-wallet` | Comprehensive wallet analysis |
| `mcp search` | Search (free) |
| `mcp tools` | List all 21 tools |

## Testing

```bash
npm test
```

64 tests covering cache, rate limiter, signal log, and API client.

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
