import { describe, it, expect } from 'vitest';
import {
  scoreGrounding,
  scoreSpecificity,
  scoreDuplication,
  scoreJsonHealth,
  countFalsePositives,
  evaluateFindings,
  formatEvalReport,
} from './review-evaluator.js';
import type { AgentFinding, AgentOutput } from '../agents/base-agent.js';

function finding(overrides: Partial<AgentFinding> = {}): AgentFinding {
  return {
    agent: 'test-agent',
    priority: 'medium',
    category: 'general',
    message: 'A specific issue was found in the code',
    ...overrides,
  };
}

function agentOutput(overrides: Partial<AgentOutput> = {}): AgentOutput {
  return {
    agent: 'test-agent',
    findings: [],
    summary: 'Analysis complete',
    confidence: 0.8,
    ...overrides,
  };
}

describe('scoreGrounding', () => {
  it('returns 100 for no findings', () => {
    expect(scoreGrounding([], ['a.ts'])).toBe(100);
  });

  it('returns 100 when all findings reference diff files', () => {
    const findings = [finding({ file: 'a.ts' }), finding({ file: 'b.ts' })];
    expect(scoreGrounding(findings, ['a.ts', 'b.ts'])).toBe(100);
  });

  it('returns 0 when no findings reference diff files', () => {
    const findings = [finding({ file: 'x.ts' }), finding({ file: 'y.ts' })];
    expect(scoreGrounding(findings, ['a.ts'])).toBe(0);
  });

  it('counts findings without file as ungrounded', () => {
    const findings = [finding({ file: undefined })];
    expect(scoreGrounding(findings, ['a.ts'])).toBe(0);
  });

  it('returns 50 for half grounded', () => {
    const findings = [finding({ file: 'a.ts' }), finding({ file: 'x.ts' })];
    expect(scoreGrounding(findings, ['a.ts'])).toBe(50);
  });
});

describe('scoreSpecificity', () => {
  it('returns 100 for no findings', () => {
    expect(scoreSpecificity([])).toBe(100);
  });

  it('returns 100 for specific findings', () => {
    const findings = [
      finding({ message: 'Buffer overflow in line 42 due to unchecked input length' }),
    ];
    expect(scoreSpecificity(findings)).toBe(100);
  });

  it('flags vague findings', () => {
    const findings = [
      finding({ message: 'Consider adding error handling here' }),
      finding({ message: 'Ensure proper validation is in place' }),
    ];
    expect(scoreSpecificity(findings)).toBe(0);
  });

  it('mixed: 50% specific', () => {
    const findings = [
      finding({ message: 'SQL injection via unsanitized user input' }),
      finding({ message: 'Consider using a more robust approach' }),
    ];
    expect(scoreSpecificity(findings)).toBe(50);
  });
});

describe('scoreDuplication', () => {
  it('returns 100 for no findings', () => {
    expect(scoreDuplication([])).toBe(100);
  });

  it('returns 100 for single finding', () => {
    expect(scoreDuplication([finding()])).toBe(100);
  });

  it('returns 100 for unique findings', () => {
    const findings = [
      finding({ message: 'SQL injection vulnerability' }),
      finding({ message: 'Missing authentication check' }),
    ];
    expect(scoreDuplication(findings)).toBe(100);
  });

  it('detects substring duplicates', () => {
    const findings = [
      finding({ message: 'Missing error handling in function' }),
      finding({ message: 'Missing error handling in function processData' }),
    ];
    expect(scoreDuplication(findings)).toBe(50);
  });
});

describe('scoreJsonHealth', () => {
  it('returns 100 for no outputs', () => {
    expect(scoreJsonHealth([])).toBe(100);
  });

  it('returns 100 when all agents parsed OK', () => {
    const outputs = [agentOutput(), agentOutput({ agent: 'security' })];
    expect(scoreJsonHealth(outputs)).toBe(100);
  });

  it('detects failed JSON parsing', () => {
    const outputs = [
      agentOutput(),
      agentOutput({ confidence: 0, summary: 'Failed to parse agent response (no JSON found)' }),
    ];
    expect(scoreJsonHealth(outputs)).toBe(50);
  });
});

describe('countFalsePositives', () => {
  it('returns 0 for empty findings', () => {
    expect(countFalsePositives([], ['a.ts']).count).toBe(0);
  });

  it('flags hallucinated files', () => {
    const findings = [finding({ file: '.env:10' })];
    const { count, reasons } = countFalsePositives(findings, ['a.ts']);
    expect(count).toBe(1);
    expect(reasons[0]).toContain('Hallucinated file');
  });

  it('flags generic advice without file', () => {
    const findings = [
      finding({ file: undefined, message: 'Ensure adequate test coverage for all modules' }),
    ];
    const { count } = countFalsePositives(findings, ['a.ts']);
    expect(count).toBe(1);
  });

  it('flags CSRF in non-web codebase', () => {
    const findings = [finding({ category: 'csrf', file: 'a.ts' })];
    const { count } = countFalsePositives(findings, ['a.ts']);
    expect(count).toBe(1);
  });

  it('does not flag valid findings', () => {
    const findings = [finding({ file: 'a.ts', message: 'Unchecked return value' })];
    const { count } = countFalsePositives(findings, ['a.ts']);
    expect(count).toBe(0);
  });
});

describe('evaluateFindings', () => {
  it('returns perfect score for empty findings', () => {
    const result = evaluateFindings([], ['a.ts'], [agentOutput()]);
    expect(result.score).toBe(100);
    expect(result.totalFindings).toBe(0);
    expect(result.falsePositiveCount).toBe(0);
  });

  it('scores well-grounded specific findings highly', () => {
    const findings = [
      finding({ file: 'a.ts', message: 'Buffer overflow in parseInput at line 42' }),
    ];
    const result = evaluateFindings(findings, ['a.ts'], [
      agentOutput({ findings }),
    ]);
    expect(result.score).toBeGreaterThan(80);
    expect(result.groundingScore).toBe(100);
    expect(result.specificityScore).toBe(100);
  });

  it('scores poorly for all-hallucinated findings', () => {
    const findings = [
      finding({ file: 'nonexistent.ts', message: 'Consider adding tests' }),
    ];
    const result = evaluateFindings(findings, ['a.ts'], [
      agentOutput({ findings }),
    ]);
    expect(result.score).toBeLessThan(50);
    expect(result.groundingScore).toBe(0);
    expect(result.falsePositiveCount).toBe(1);
  });

  it('includes per-agent breakdown', () => {
    const findings = [finding({ agent: 'security', file: 'a.ts' })];
    const result = evaluateFindings(findings, ['a.ts'], [
      agentOutput({ agent: 'security', findings }),
    ]);
    expect(result.agentEvals).toHaveLength(1);
    expect(result.agentEvals[0].agent).toBe('security');
    expect(result.agentEvals[0].groundedCount).toBe(1);
  });
});

describe('formatEvalReport', () => {
  it('produces readable output', () => {
    const result = evaluateFindings([], ['a.ts'], [agentOutput()]);
    const report = formatEvalReport(result);
    expect(report).toContain('Overall Score:');
    expect(report).toContain('Grounding:');
    expect(report).toContain('Per-Agent');
  });
});
