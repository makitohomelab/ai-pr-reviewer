import { describe, it, expect } from 'vitest';
import { formatFindingsAsMarkdown, calculateImportance, type AgentResult } from './test-quality.js';
import type { FileChange } from '../lib/github.js';

describe('formatFindingsAsMarkdown', () => {
  it('should format empty findings with reviewed areas', () => {
    const result: AgentResult = {
      findings: [],
      reviewed: [
        { area: 'security', status: 'pass', details: 'No user input handling or auth changes detected' },
        { area: 'breaking', status: 'pass', details: 'No exported APIs or signatures modified' },
        { area: 'quality', status: 'pass', details: 'Simple change with clear intent' },
      ],
      summary: 'No issues found.',
      confidence: 0.95,
    };

    const md = formatFindingsAsMarkdown(result);

    expect(md).toContain('## AI Review');
    expect(md).toContain('✅ **Security**');
    expect(md).toContain('No user input handling');
    expect(md).toContain('Confidence: 95%');
  });

  it('should format findings with issues', () => {
    const result: AgentResult = {
      findings: [
        { priority: 'critical', file: 'src/auth.ts', line: 42, message: 'SQL injection risk' },
        { priority: 'high', file: 'src/api.ts', line: 15, message: 'API signature changed' },
        { priority: 'medium', file: 'src/handler.ts', message: 'Missing test for error path' },
      ],
      reviewed: [
        { area: 'security', status: 'fail', details: 'Found SQL injection vulnerability in user input handling' },
        { area: 'breaking', status: 'warn', details: 'API signature changed which may affect callers' },
        { area: 'quality', status: 'warn', details: 'Missing error path test coverage' },
      ],
      summary: 'Found some issues to address.',
      confidence: 0.8,
    };

    const md = formatFindingsAsMarkdown(result);

    // Check reviewed sections with context
    expect(md).toContain('❌ **Security**');
    expect(md).toContain('SQL injection vulnerability');
    expect(md).toContain('⚠️ **Breaking Changes**');
    expect(md).toContain('API signature changed');

    // Check issues section
    expect(md).toContain('### Issues Found');
    expect(md).toContain('🔴 **critical**');
    expect(md).toContain('🟠 **high**');
    expect(md).toContain('🟡 **medium**');
  });

  it('should fallback to old format when no reviewed data', () => {
    const result: AgentResult = {
      findings: [
        { priority: 'critical', file: 'a.ts', message: 'Issue 1' },
      ],
      reviewed: [],
      summary: 'Security issue found.',
      confidence: 0.9,
    };

    const md = formatFindingsAsMarkdown(result);

    // Should use fallback format
    expect(md).toContain('❌ **Security**');
    expect(md).toContain('Issue 1');
  });

  it('should handle findings without file location', () => {
    const result: AgentResult = {
      findings: [
        { priority: 'medium', message: 'General test coverage concern' },
      ],
      reviewed: [
        { area: 'security', status: 'pass', details: 'No security-relevant changes' },
        { area: 'breaking', status: 'pass', details: 'No API changes' },
        { area: 'quality', status: 'warn', details: 'Test coverage could be improved' },
      ],
      summary: 'Review complete.',
      confidence: 0.75,
    };

    const md = formatFindingsAsMarkdown(result);
    expect(md).toContain('General test coverage concern');
    expect(md).toContain('Confidence: 75%');
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

describe('output format', () => {
  it('should include summary in output', () => {
    const result: AgentResult = {
      findings: [],
      reviewed: [
        { area: 'security', status: 'pass', details: 'Clean' },
        { area: 'breaking', status: 'pass', details: 'No changes' },
        { area: 'quality', status: 'pass', details: 'Good' },
      ],
      summary: 'All checks passed.',
      confidence: 0.95,
    };

    const md = formatFindingsAsMarkdown(result);
    expect(md).toContain('**Summary**: All checks passed.');
  });

  it('should show benchmark data when provided', () => {
    const result: AgentResult = {
      findings: [],
      reviewed: [
        { area: 'security', status: 'pass', details: 'Clean' },
        { area: 'breaking', status: 'pass', details: 'No changes' },
        { area: 'quality', status: 'pass', details: 'Good' },
      ],
      summary: 'Review complete.',
      confidence: 0.9,
      benchmark: {
        llmLatencyMs: 2500,
        totalLatencyMs: 2600,
        inputTokens: 500,
        outputTokens: 100,
        model: 'qwen3-coder',
      },
    };

    const md = formatFindingsAsMarkdown(result);
    expect(md).toContain('qwen3-coder');
    expect(md).toContain('2.5s');
  });
});
