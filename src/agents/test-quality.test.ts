import { describe, it, expect } from 'vitest';
import { formatFindingsAsMarkdown, calculateImportance, type AgentResult } from './test-quality.js';
import type { FileChange } from '../lib/github.js';

describe('formatFindingsAsMarkdown', () => {
  it('should format empty findings correctly', () => {
    const result: AgentResult = {
      findings: [],
      summary: 'No issues found.',
      confidence: 0.95,
    };

    const md = formatFindingsAsMarkdown(result);

    expect(md).toContain('## AI Review');
    expect(md).toContain('**Security**: None found');
    expect(md).toContain('**Breaking**: None found');
    expect(md).toContain('**Tests**: No gaps found');
    expect(md).toContain('0 issues | Confidence: 95%');
  });

  it('should format findings by priority', () => {
    const result: AgentResult = {
      findings: [
        {
          priority: 'critical',
          file: 'src/auth.ts',
          line: 42,
          message: 'SQL injection risk',
        },
        {
          priority: 'high',
          file: 'src/api.ts',
          line: 15,
          message: 'API signature changed',
        },
        {
          priority: 'medium',
          file: 'src/handler.ts',
          message: 'Missing test for error path',
        },
      ],
      summary: 'Found some issues to address.',
      confidence: 0.8,
    };

    const md = formatFindingsAsMarkdown(result);

    // Check priority sections
    expect(md).toContain('**Security**: SQL injection risk in `src/auth.ts:42`');
    expect(md).toContain('**Breaking**: API signature changed in `src/api.ts:15`');
    expect(md).toContain('**Tests**: Missing test for error path in `src/handler.ts`');

    // Check footer
    expect(md).toContain('3 issues | Confidence: 80%');
  });

  it('should handle multiple findings per priority', () => {
    const result: AgentResult = {
      findings: [
        { priority: 'critical', file: 'a.ts', message: 'Issue 1' },
        { priority: 'critical', file: 'b.ts', message: 'Issue 2' },
      ],
      summary: 'Multiple security issues.',
      confidence: 0.9,
    };

    const md = formatFindingsAsMarkdown(result);

    // Multiple findings should be joined with semicolons
    expect(md).toContain('Issue 1 in `a.ts`; Issue 2 in `b.ts`');
    expect(md).toContain('2 issues');
  });

  it('should handle findings without file location', () => {
    const result: AgentResult = {
      findings: [
        { priority: 'medium', message: 'General test coverage concern' },
      ],
      summary: 'Review complete.',
      confidence: 0.75,
    };

    const md = formatFindingsAsMarkdown(result);
    expect(md).toContain('**Tests**: General test coverage concern');
    expect(md).toContain('1 issues | Confidence: 75%');
  });
});

describe('calculateImportance', () => {
  const makeFile = (filename: string, additions = 10, deletions = 5): FileChange => ({
    filename,
    status: 'modified',
    additions,
    deletions,
  });

  it('should return low for small PRs', () => {
    const files = [makeFile('src/utils.ts', 20, 10)];
    expect(calculateImportance(files)).toBe('low');
  });

  it('should return medium for moderate PRs', () => {
    const files = [
      makeFile('src/a.ts', 50, 20),
      makeFile('src/b.ts', 30, 10),
      makeFile('src/c.ts', 20, 5),
      makeFile('src/d.ts', 10, 5),
    ];
    expect(calculateImportance(files)).toBe('medium');
  });

  it('should return high for large PRs (>500 lines)', () => {
    const files = [makeFile('src/big.ts', 400, 150)];
    expect(calculateImportance(files)).toBe('high');
  });

  it('should return high for PRs with many files (>10)', () => {
    const files = Array.from({ length: 12 }, (_, i) => makeFile(`src/file${i}.ts`, 5, 2));
    expect(calculateImportance(files)).toBe('high');
  });

  it('should return high for PRs touching sensitive files', () => {
    const sensitivePatterns = ['auth.ts', 'login.ts', 'password-reset.ts', '.env.example', 'api/routes.ts'];
    for (const filename of sensitivePatterns) {
      const files = [makeFile(filename, 5, 2)];
      expect(calculateImportance(files)).toBe('high');
    }
  });
});

describe('output size', () => {
  it('should produce concise output under 500 chars for typical review', () => {
    const result: AgentResult = {
      findings: [
        { priority: 'high', file: 'api.ts', line: 42, message: 'API signature changed' },
        { priority: 'medium', file: 'handler.ts', message: 'Missing error test' },
      ],
      summary: 'Two issues found.',
      confidence: 0.85,
    };

    const md = formatFindingsAsMarkdown(result);
    expect(md.length).toBeLessThan(500);
  });

  it('should stay concise even with max findings', () => {
    const result: AgentResult = {
      findings: [
        { priority: 'critical', file: 'auth.ts', line: 10, message: 'SQL injection risk' },
        { priority: 'critical', file: 'login.ts', line: 20, message: 'Hardcoded secret' },
        { priority: 'high', file: 'api.ts', line: 30, message: 'Breaking API change' },
        { priority: 'medium', file: 'test.ts', line: 40, message: 'Missing test case' },
        { priority: 'medium', file: 'util.ts', line: 50, message: 'Null check missing' },
      ],
      summary: 'Multiple issues found.',
      confidence: 0.75,
    };

    const md = formatFindingsAsMarkdown(result);
    // With 5 findings, should still be reasonably compact
    expect(md.length).toBeLessThan(700);
  });
});
