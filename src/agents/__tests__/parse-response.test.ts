import { describe, it, expect } from 'vitest';
import { parseCommonResponse } from '../base-agent.js';

describe('parseCommonResponse', () => {
  it('should parse valid JSON with findings and set agent name', () => {
    const response = JSON.stringify({
      findings: [
        {
          priority: 'high',
          category: 'security',
          file: 'src/auth.ts',
          line: 42,
          message: 'Potential SQL injection',
          suggestion: 'Use parameterized queries',
        },
        {
          priority: 'medium',
          category: 'performance',
          message: 'Inefficient loop',
        },
      ],
      summary: 'Found 2 issues',
      confidence: 0.9,
    });

    const result = parseCommonResponse(response, 'TestAgent');

    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].agent).toBe('TestAgent');
    expect(result.findings[0].priority).toBe('high');
    expect(result.findings[0].category).toBe('security');
    expect(result.findings[0].file).toBe('src/auth.ts');
    expect(result.findings[0].line).toBe(42);
    expect(result.findings[0].message).toBe('Potential SQL injection');
    expect(result.findings[0].suggestion).toBe('Use parameterized queries');
    expect(result.findings[1].agent).toBe('TestAgent');
    expect(result.findings[1].priority).toBe('medium');
    expect(result.summary).toBe('Found 2 issues');
    expect(result.confidence).toBe(0.9);
  });

  it('should extract JSON wrapped in markdown code blocks', () => {
    const response = `Here is my analysis:

\`\`\`json
{
  "findings": [
    {
      "priority": "critical",
      "category": "security",
      "message": "Hardcoded credentials"
    }
  ],
  "summary": "Critical security issue found",
  "confidence": 0.95
}
\`\`\`

Hope this helps!`;

    const result = parseCommonResponse(response, 'SecurityAgent');

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].agent).toBe('SecurityAgent');
    expect(result.findings[0].priority).toBe('critical');
    expect(result.findings[0].message).toBe('Hardcoded credentials');
    expect(result.summary).toBe('Critical security issue found');
    expect(result.confidence).toBe(0.95);
  });

  it('should handle truncated/malformed JSON gracefully', () => {
    const response = '{"findings": [{"priority": "high"}] invalid}';

    const result = parseCommonResponse(response, 'TestAgent');

    expect(result.findings).toEqual([]);
    expect(result.summary).toBe('Failed to parse agent response (malformed JSON)');
    expect(result.confidence).toBe(0);
  });

  it('should handle plain text with no JSON', () => {
    const response = 'This is just plain text without any JSON structure.';

    const result = parseCommonResponse(response, 'TestAgent');

    expect(result.findings).toEqual([]);
    expect(result.summary).toBe('Failed to parse agent response (no JSON found)');
    expect(result.confidence).toBe(0);
  });

  it('should extract JSON with surrounding text', () => {
    const response = `Here is my analysis: {"findings": [{"priority": "high", "category": "bug", "message": "Null pointer"}], "summary": "Found issue", "confidence": 0.85} hope this helps`;

    const result = parseCommonResponse(response, 'TestAgent');

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].priority).toBe('high');
    expect(result.findings[0].message).toBe('Null pointer');
    expect(result.summary).toBe('Found issue');
    expect(result.confidence).toBe(0.85);
  });

  it('should handle empty string gracefully', () => {
    const response = '';

    const result = parseCommonResponse(response, 'TestAgent');

    expect(result.findings).toEqual([]);
    expect(result.summary).toBe('Failed to parse agent response (no JSON found)');
    expect(result.confidence).toBe(0);
  });

  it('should handle valid JSON with empty findings array', () => {
    const response = JSON.stringify({
      findings: [],
      summary: 'No issues found in this PR',
      confidence: 1.0,
    });

    const result = parseCommonResponse(response, 'TestAgent');

    expect(result.findings).toEqual([]);
    expect(result.summary).toBe('No issues found in this PR');
    expect(result.confidence).toBe(1.0);
  });

  it('should limit findings to 5 max', () => {
    const response = JSON.stringify({
      findings: Array.from({ length: 10 }, (_, i) => ({
        priority: 'medium',
        category: 'style',
        message: `Issue ${i + 1}`,
      })),
      summary: 'Found 10 issues',
      confidence: 0.8,
    });

    const result = parseCommonResponse(response, 'TestAgent');

    expect(result.findings).toHaveLength(5);
  });

  it('should normalize invalid priority to medium', () => {
    const response = JSON.stringify({
      findings: [
        { priority: 'invalid', category: 'test', message: 'Test message' },
        { priority: 'low', category: 'test', message: 'Test message 2' },
        { category: 'test', message: 'Test message 3' },
      ],
      summary: 'Test',
      confidence: 0.5,
    });

    const result = parseCommonResponse(response, 'TestAgent');

    expect(result.findings).toHaveLength(3);
    expect(result.findings[0].priority).toBe('medium');
    expect(result.findings[1].priority).toBe('medium');
    expect(result.findings[2].priority).toBe('medium');
  });

  it('should provide defaults for missing fields', () => {
    const response = JSON.stringify({
      findings: [
        { priority: 'high' }, // Missing category and message
      ],
      // Missing summary
      confidence: 0.7,
    });

    const result = parseCommonResponse(response, 'TestAgent');

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].category).toBe('general');
    expect(result.findings[0].message).toBe('No details');
    expect(result.summary).toBe('Analysis complete');
    expect(result.confidence).toBe(0.7);
  });

  it('should clamp confidence to 0-1 range', () => {
    const response1 = JSON.stringify({
      findings: [],
      summary: 'Test',
      confidence: 1.5,
    });

    const response2 = JSON.stringify({
      findings: [],
      summary: 'Test',
      confidence: -0.5,
    });

    const result1 = parseCommonResponse(response1, 'TestAgent');
    const result2 = parseCommonResponse(response2, 'TestAgent');

    expect(result1.confidence).toBe(1);
    expect(result2.confidence).toBe(0);
  });

  it('should handle invalid line numbers', () => {
    const response = JSON.stringify({
      findings: [
        { priority: 'high', category: 'test', message: 'Test', line: 'invalid' },
        { priority: 'high', category: 'test', message: 'Test 2', line: null },
      ],
      summary: 'Test',
      confidence: 0.8,
    });

    const result = parseCommonResponse(response, 'TestAgent');

    expect(result.findings[0].line).toBeUndefined();
    expect(result.findings[1].line).toBeUndefined();
  });
});
