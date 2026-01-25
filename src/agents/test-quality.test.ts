import { describe, it, expect } from 'vitest';
import { formatFindingsAsMarkdown, type AgentResult } from './test-quality.js';

describe('formatFindingsAsMarkdown', () => {
  it('should format empty findings correctly', () => {
    const result: AgentResult = {
      findings: [],
      summary: 'No issues found.',
      confidence: 0.95,
      testCoverageAssessment: 'adequate',
    };

    const md = formatFindingsAsMarkdown(result);

    expect(md).toContain('AI Code Review');
    expect(md).toContain('No issues found');
    expect(md).toContain('✅ No issues found!');
    expect(md).toContain('Test Coverage**: ✅ Adequate');
    expect(md).toContain('Confidence**: 95%');
  });

  it('should format findings with correct severity emojis', () => {
    const result: AgentResult = {
      findings: [
        {
          type: 'bug',
          severity: 'error',
          file: 'src/app.ts',
          line: 42,
          message: 'Null pointer risk',
        },
        {
          type: 'quality',
          severity: 'warning',
          file: 'src/utils.ts',
          message: 'Complex function',
          suggestion: 'Consider breaking into smaller functions',
        },
        {
          type: 'suggestion',
          severity: 'info',
          message: 'Consider adding more comments',
        },
      ],
      summary: 'Found some issues to address.',
      confidence: 0.8,
      testCoverageAssessment: 'needs-improvement',
    };

    const md = formatFindingsAsMarkdown(result);

    // Check severity emojis
    expect(md).toContain('🔴'); // error
    expect(md).toContain('🟡'); // warning
    expect(md).toContain('🔵'); // info

    // Check type labels
    expect(md).toContain('Potential Bug');
    expect(md).toContain('Code Quality');
    expect(md).toContain('Suggestion');

    // Check file locations
    expect(md).toContain('`src/app.ts:42`');
    expect(md).toContain('`src/utils.ts`');

    // Check suggestion
    expect(md).toContain('💡 Consider breaking into smaller functions');

    // Check coverage assessment
    expect(md).toContain('⚠️ Needs Improvement');
  });

  it('should handle test coverage assessments correctly', () => {
    const testCases: Array<[AgentResult['testCoverageAssessment'], string]> = [
      ['adequate', '✅ Adequate'],
      ['needs-improvement', '⚠️ Needs Improvement'],
      ['missing', '❌ Missing'],
      ['not-applicable', '➖ N/A'],
    ];

    for (const [assessment, expected] of testCases) {
      const result: AgentResult = {
        findings: [],
        summary: 'Test',
        confidence: 0.9,
        testCoverageAssessment: assessment,
      };

      const md = formatFindingsAsMarkdown(result);
      expect(md).toContain(expected);
    }
  });

  it('should include the summary in output', () => {
    const result: AgentResult = {
      findings: [],
      summary: 'This is a custom summary of the review.',
      confidence: 0.75,
      testCoverageAssessment: 'adequate',
    };

    const md = formatFindingsAsMarkdown(result);
    expect(md).toContain('This is a custom summary of the review.');
  });
});
