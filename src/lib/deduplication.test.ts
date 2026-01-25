import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  calculateSimilarity,
  deduplicateFindings,
  deduplicateFindingsWithStats,
} from './deduplication.js';
import type { AgentFinding } from '../agents/base-agent.js';

describe('calculateSimilarity', () => {
  it('returns 1 for identical findings', () => {
    const finding: AgentFinding = {
      agent: 'security',
      priority: 'high',
      category: 'sql-injection',
      file: 'src/db.ts',
      line: 42,
      message: 'Potential SQL injection vulnerability',
    };

    expect(calculateSimilarity(finding, finding)).toBe(1);
  });

  it('returns high similarity for similar messages', () => {
    const a: AgentFinding = {
      agent: 'security',
      priority: 'high',
      category: 'sql-injection',
      file: 'src/db.ts',
      line: 42,
      message: 'Potential SQL injection vulnerability in query',
    };

    const b: AgentFinding = {
      agent: 'security',
      priority: 'high',
      category: 'sql-injection',
      file: 'src/db.ts',
      line: 42,
      message: 'Potential SQL injection vulnerability in database query',
    };

    const similarity = calculateSimilarity(a, b);
    expect(similarity).toBeGreaterThan(0.8);
  });

  it('returns low similarity for different files', () => {
    const a: AgentFinding = {
      agent: 'security',
      priority: 'high',
      category: 'sql-injection',
      file: 'src/db.ts',
      line: 42,
      message: 'SQL injection vulnerability',
    };

    const b: AgentFinding = {
      agent: 'security',
      priority: 'high',
      category: 'sql-injection',
      file: 'src/api.ts',
      line: 100,
      message: 'SQL injection vulnerability',
    };

    const similarity = calculateSimilarity(a, b);
    // Different files should reduce similarity below dedup threshold (0.8)
    expect(similarity).toBeLessThanOrEqual(0.7);
  });

  it('handles findings without file info', () => {
    const a: AgentFinding = {
      agent: 'breaking-changes',
      priority: 'medium',
      category: 'api-compatibility',
      message: 'Breaking change detected in API',
    };

    const b: AgentFinding = {
      agent: 'breaking-changes',
      priority: 'medium',
      category: 'api-compatibility',
      message: 'Breaking change detected in API',
    };

    const similarity = calculateSimilarity(a, b);
    expect(similarity).toBeGreaterThan(0.6);
  });

  it('handles very long messages by truncating', () => {
    const longMessage = 'A'.repeat(500);
    const a: AgentFinding = {
      agent: 'security',
      priority: 'high',
      category: 'sql-injection',
      file: 'src/db.ts',
      message: longMessage,
    };

    const b: AgentFinding = {
      agent: 'security',
      priority: 'high',
      category: 'sql-injection',
      file: 'src/db.ts',
      message: longMessage + ' extra',
    };

    // Should not throw or hang
    const similarity = calculateSimilarity(a, b);
    expect(similarity).toBeGreaterThan(0.9);
  });
});

describe('deduplicateFindings', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicateFindings([])).toEqual([]);
  });

  it('keeps unique findings', () => {
    const findings: AgentFinding[] = [
      {
        agent: 'security',
        priority: 'high',
        category: 'sql-injection',
        file: 'src/db.ts',
        message: 'SQL injection in query builder',
      },
      {
        agent: 'performance',
        priority: 'medium',
        category: 'n-plus-one',
        file: 'src/api.ts',
        message: 'N+1 query detected',
      },
    ];

    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(2);
  });

  it('removes duplicate findings', () => {
    const findings: AgentFinding[] = [
      {
        agent: 'security',
        priority: 'high',
        category: 'sql-injection',
        file: 'src/db.ts',
        line: 42,
        message: 'SQL injection vulnerability detected',
      },
      {
        agent: 'security',
        priority: 'high',
        category: 'sql-injection',
        file: 'src/db.ts',
        line: 42,
        message: 'SQL injection vulnerability found',
      },
    ];

    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
  });

  it('keeps higher priority finding when duplicates exist', () => {
    const findings: AgentFinding[] = [
      {
        agent: 'security',
        priority: 'medium',
        category: 'sql-injection',
        file: 'src/db.ts',
        line: 42,
        message: 'Potential SQL injection',
      },
      {
        agent: 'security',
        priority: 'critical',
        category: 'sql-injection',
        file: 'src/db.ts',
        line: 42,
        message: 'Potential SQL injection vulnerability',
      },
    ];

    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe('critical');
  });

  it('respects custom threshold option', () => {
    const findings: AgentFinding[] = [
      {
        agent: 'security',
        priority: 'high',
        category: 'sql-injection',
        file: 'src/db.ts',
        message: 'SQL injection detected',
      },
      {
        agent: 'security',
        priority: 'high',
        category: 'sql-injection',
        file: 'src/db.ts',
        message: 'SQL injection issue found',
      },
    ];

    // With very high threshold, nothing is a duplicate
    const resultHigh = deduplicateFindings(findings, { threshold: 0.99 });
    expect(resultHigh).toHaveLength(2);

    // With low threshold, similar findings are duplicates
    const resultLow = deduplicateFindings(findings, { threshold: 0.5 });
    expect(resultLow).toHaveLength(1);
  });

  describe('env var threshold', () => {
    const originalEnv = process.env.DEDUP_THRESHOLD;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.DEDUP_THRESHOLD;
      } else {
        process.env.DEDUP_THRESHOLD = originalEnv;
      }
    });

    it('respects DEDUP_THRESHOLD env var', () => {
      process.env.DEDUP_THRESHOLD = '0.99';

      const findings: AgentFinding[] = [
        {
          agent: 'security',
          priority: 'high',
          category: 'sql-injection',
          file: 'src/db.ts',
          message: 'SQL injection detected',
        },
        {
          agent: 'security',
          priority: 'high',
          category: 'sql-injection',
          file: 'src/db.ts',
          message: 'SQL injection issue found',
        },
      ];

      const result = deduplicateFindings(findings);
      expect(result).toHaveLength(2);
    });
  });

  it('uses bucket-based optimization for different files', () => {
    const findings: AgentFinding[] = [
      {
        agent: 'security',
        priority: 'high',
        category: 'sql-injection',
        file: 'src/db.ts',
        message: 'SQL injection vulnerability',
      },
      {
        agent: 'security',
        priority: 'high',
        category: 'sql-injection',
        file: 'src/api.ts',
        message: 'SQL injection vulnerability',
      },
      {
        agent: 'security',
        priority: 'medium',
        category: 'sql-injection',
        file: 'src/db.ts',
        message: 'SQL injection vulnerability detected', // Very similar to first
      },
    ];

    const result = deduplicateFindings(findings);
    // Third finding deduped with first (same file), second kept (different file)
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.file).sort()).toEqual(['src/api.ts', 'src/db.ts']);
  });
});

describe('deduplicateFindingsWithStats', () => {
  it('returns findings and statistics', () => {
    const findings: AgentFinding[] = [
      {
        agent: 'security',
        priority: 'high',
        category: 'sql-injection',
        file: 'src/db.ts',
        line: 42,
        message: 'SQL injection detected',
      },
      {
        agent: 'security',
        priority: 'high',
        category: 'sql-injection',
        file: 'src/db.ts',
        line: 42,
        message: 'SQL injection found',
      },
      {
        agent: 'performance',
        priority: 'medium',
        category: 'n-plus-one',
        file: 'src/api.ts',
        message: 'N+1 query detected',
      },
    ];

    const { findings: deduplicated, stats } = deduplicateFindingsWithStats(findings);

    expect(deduplicated).toHaveLength(2);
    expect(stats.inputCount).toBe(3);
    expect(stats.outputCount).toBe(2);
    expect(stats.duplicatesRemoved).toBe(1);
    expect(stats.threshold).toBe(0.8);
  });

  it('allows custom threshold in stats', () => {
    const findings: AgentFinding[] = [
      {
        agent: 'security',
        priority: 'high',
        category: 'sql-injection',
        file: 'src/db.ts',
        message: 'SQL injection',
      },
    ];

    const { stats } = deduplicateFindingsWithStats(findings, { threshold: 0.7 });
    expect(stats.threshold).toBe(0.7);
  });
});
