import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SignalLog, type LoggedSignal } from '../src/signal-log.js';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import type { OpportunitySignal } from '../src/types.js';

const TEST_LOG_PATH = join(process.cwd(), '.test-signals.json');

function createTestSignal(overrides: Partial<OpportunitySignal> = {}): OpportunitySignal {
  return {
    type: 'accumulation',
    token: '0x1234567890abcdef',
    symbol: 'TEST',
    chain: 'ethereum',
    score: 5.0,
    reason: 'Test signal',
    metrics: { netflow24h: 100000 },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('SignalLog', () => {
  let log: SignalLog;

  beforeEach(() => {
    // Use in-memory (no autosave to avoid file operations in most tests)
    log = new SignalLog(TEST_LOG_PATH, false);
  });

  afterEach(() => {
    if (existsSync(TEST_LOG_PATH)) {
      unlinkSync(TEST_LOG_PATH);
    }
  });

  describe('log', () => {
    it('should log a signal and return logged version', () => {
      const signal = createTestSignal();
      const logged = log.log(signal);

      expect(logged.id).toBeDefined();
      expect(logged.loggedAt).toBeDefined();
      expect(logged.acted).toBe(false);
      expect(logged.symbol).toBe('TEST');
    });

    it('should generate unique IDs based on signal properties', () => {
      const signal1 = createTestSignal({ token: '0xaaa' });
      const signal2 = createTestSignal({ token: '0xbbb' });

      const logged1 = log.log(signal1);
      const logged2 = log.log(signal2);

      expect(logged1.id).not.toBe(logged2.id);
    });

    it('should return existing signal for duplicates', () => {
      const signal = createTestSignal();

      const logged1 = log.log(signal);
      const logged2 = log.log(signal);

      expect(logged1.id).toBe(logged2.id);
    });
  });

  describe('logBatch', () => {
    it('should log multiple signals at once', () => {
      const signals = [
        createTestSignal({ token: '0x111' }),
        createTestSignal({ token: '0x222' }),
        createTestSignal({ token: '0x333' }),
      ];

      const logged = log.logBatch(signals);

      expect(logged).toHaveLength(3);
      expect(logged[0].id).not.toBe(logged[1].id);
    });
  });

  describe('get', () => {
    it('should retrieve signal by ID', () => {
      const signal = createTestSignal();
      const logged = log.log(signal);

      const retrieved = log.get(logged.id);

      expect(retrieved).toEqual(logged);
    });

    it('should return undefined for unknown ID', () => {
      expect(log.get('nonexistent')).toBeUndefined();
    });
  });

  describe('markActed', () => {
    it('should mark signal as acted', () => {
      const signal = createTestSignal();
      const logged = log.log(signal);

      const updated = log.markActed(logged.id, 'buy', 'Test trade');

      expect(updated?.acted).toBe(true);
      expect(updated?.outcome?.action).toBe('buy');
      expect(updated?.outcome?.executedAt).toBeDefined();
      expect(updated?.outcome?.notes).toBe('Test trade');
    });

    it('should return undefined for unknown ID', () => {
      expect(log.markActed('nonexistent', 'buy')).toBeUndefined();
    });
  });

  describe('recordOutcome', () => {
    it('should record trade outcome', () => {
      const signal = createTestSignal();
      const logged = log.log(signal);
      log.markActed(logged.id, 'buy');

      const updated = log.recordOutcome(logged.id, {
        entryPrice: 1.0,
        exitPrice: 1.5,
      });

      expect(updated?.outcome?.entryPrice).toBe(1.0);
      expect(updated?.outcome?.exitPrice).toBe(1.5);
      expect(updated?.outcome?.pnl).toBe(0.5);
      expect(updated?.outcome?.pnlPercent).toBe(50);
    });

    it('should calculate PnL automatically', () => {
      const signal = createTestSignal();
      const logged = log.log(signal);

      log.recordOutcome(logged.id, { entryPrice: 100, exitPrice: 80 });
      const updated = log.get(logged.id);

      expect(updated?.outcome?.pnl).toBe(-20);
      expect(updated?.outcome?.pnlPercent).toBe(-20);
    });
  });

  describe('find', () => {
    beforeEach(() => {
      log.log(createTestSignal({ chain: 'ethereum', type: 'accumulation', score: 5 }));
      log.log(createTestSignal({ chain: 'base', type: 'accumulation', score: 3 }));
      log.log(createTestSignal({ chain: 'ethereum', type: 'distribution', score: 7 }));
    });

    it('should return all signals by default', () => {
      const results = log.find();
      expect(results).toHaveLength(3);
    });

    it('should filter by chain', () => {
      const results = log.find({ chains: ['ethereum'] });
      expect(results).toHaveLength(2);
    });

    it('should filter by mode', () => {
      const results = log.find({ modes: ['distribution'] });
      expect(results).toHaveLength(1);
    });

    it('should filter by minScore', () => {
      const results = log.find({ minScore: 5 });
      expect(results).toHaveLength(2);
    });

    it('should filter by maxScore', () => {
      const results = log.find({ maxScore: 5 });
      expect(results).toHaveLength(2);
    });

    it('should limit results', () => {
      const results = log.find({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('should combine multiple filters', () => {
      const results = log.find({ chains: ['ethereum'], minScore: 6 });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('distribution');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const s1 = log.log(createTestSignal({ chain: 'ethereum', score: 5 }));
      const s2 = log.log(createTestSignal({ chain: 'base', score: 3 }));

      log.markActed(s1.id, 'buy');
      log.recordOutcome(s1.id, { entryPrice: 100, exitPrice: 150 });

      const stats = log.getStats();

      expect(stats.totalSignals).toBe(2);
      expect(stats.actedOn).toBe(1);
      expect(stats.skipped).toBe(1);
      expect(stats.withOutcome).toBe(1);
      expect(stats.profitableCount).toBe(1);
      expect(stats.winRate).toBe(1);
      expect(stats.avgScore).toBe(4);
      expect(stats.byChain['ethereum']).toBe(1);
      expect(stats.byChain['base']).toBe(1);
    });

    it('should handle empty log', () => {
      const stats = log.getStats();

      expect(stats.totalSignals).toBe(0);
      expect(stats.winRate).toBe(0);
      expect(stats.avgScore).toBe(0);
    });
  });

  describe('getTokenHistory', () => {
    it('should return signals for a specific token', () => {
      log.log(createTestSignal({ token: '0xaaa', chain: 'ethereum' }));
      log.log(createTestSignal({ token: '0xaaa', chain: 'base' }));
      log.log(createTestSignal({ token: '0xbbb', chain: 'ethereum' }));

      const history = log.getTokenHistory('0xaaa');
      expect(history).toHaveLength(2);
    });

    it('should filter by chain', () => {
      log.log(createTestSignal({ token: '0xaaa', chain: 'ethereum' }));
      log.log(createTestSignal({ token: '0xaaa', chain: 'base' }));

      const history = log.getTokenHistory('0xaaa', 'ethereum');
      expect(history).toHaveLength(1);
    });
  });

  describe('hasRecentSignal', () => {
    it('should detect recent duplicate signals', () => {
      const signal = createTestSignal();
      log.log(signal);

      expect(log.hasRecentSignal(signal, 60000)).toBe(true);
    });

    it('should not detect old signals', async () => {
      const signal = createTestSignal();
      log.log(signal);

      // Simulate time passing by checking with 0ms window
      expect(log.hasRecentSignal(signal, 0)).toBe(false);
    });
  });

  describe('persistence', () => {
    it('should save and load signals', () => {
      const persistentLog = new SignalLog(TEST_LOG_PATH, true);
      const signal = createTestSignal();
      persistentLog.log(signal);

      // Create new instance that loads from file
      const loadedLog = new SignalLog(TEST_LOG_PATH, false);
      const results = loadedLog.find();

      expect(results).toHaveLength(1);
      expect(results[0].symbol).toBe('TEST');
    });
  });

  describe('clear', () => {
    it('should remove all signals', () => {
      log.log(createTestSignal({ token: '0x111' }));
      log.log(createTestSignal({ token: '0x222' }));

      log.clear();

      expect(log.find()).toHaveLength(0);
    });
  });

  describe('export', () => {
    it('should export signals as JSON', () => {
      log.log(createTestSignal());

      const exported = log.export();
      const parsed = JSON.parse(exported);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].symbol).toBe('TEST');
    });

    it('should respect filters in export', () => {
      log.log(createTestSignal({ chain: 'ethereum' }));
      log.log(createTestSignal({ chain: 'base' }));

      const exported = log.export({ chains: ['ethereum'] });
      const parsed = JSON.parse(exported);

      expect(parsed).toHaveLength(1);
    });
  });
});
