import { describe, it, expect } from 'vitest';
import { calculateSimilarity, deduplicateFindings } from './deduplication.js';
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
});
