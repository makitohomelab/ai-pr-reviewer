/**
 * Test & Quality Agent
 *
 * Specialized subagent that analyzes code changes for:
 * - Test coverage gaps
 * - Code quality issues
 * - Best practice violations
 * - Potential bugs
 *
 * Uses Claude Haiku for cost efficiency.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { FileChange } from '../lib/github.js';

export interface QualityFinding {
  type: 'test' | 'quality' | 'bug' | 'suggestion';
  severity: 'info' | 'warning' | 'error';
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

export interface AgentResult {
  findings: QualityFinding[];
  summary: string;
  confidence: number; // 0-1 score of how confident the agent is in its analysis
  testCoverageAssessment: 'adequate' | 'needs-improvement' | 'missing' | 'not-applicable';
}

const SYSTEM_PROMPT = `You are a code review expert focused on test coverage and code quality.

Your job is to analyze code changes and identify:
1. **Test Coverage**: Are new features/changes adequately tested? Are there missing test cases?
2. **Code Quality**: Are there any code smells, anti-patterns, or maintainability issues?
3. **Potential Bugs**: Do you see any logic errors, edge cases, or potential runtime issues?
4. **Best Practices**: Does the code follow language-specific best practices?

Be constructive and specific. Don't nitpick style issues unless they impact readability significantly.

Respond with a JSON object matching this structure:
{
  "findings": [
    {
      "type": "test" | "quality" | "bug" | "suggestion",
      "severity": "info" | "warning" | "error",
      "file": "path/to/file.ts",
      "line": 42,
      "message": "Clear description of the issue",
      "suggestion": "How to fix it (optional)"
    }
  ],
  "summary": "2-3 sentence overall assessment",
  "confidence": 0.85,
  "testCoverageAssessment": "needs-improvement"
}`;

function buildPrompt(files: FileChange[], prTitle: string, prBody: string): string {
  const fileSummaries = files.map((f) => {
    const status = f.status === 'added' ? '(new)' : f.status === 'removed' ? '(deleted)' : '';
    return `### ${f.filename} ${status}
+${f.additions} -${f.deletions}

\`\`\`diff
${f.patch || '(binary or too large)'}
\`\`\``;
  });

  return `## Pull Request: ${prTitle}

${prBody || '(No description provided)'}

## Files Changed

${fileSummaries.join('\n\n')}

---

Analyze these changes and provide your findings as JSON.`;
}

export async function runTestQualityAgent(
  client: Anthropic,
  files: FileChange[],
  prTitle: string,
  prBody: string
): Promise<AgentResult> {
  // Filter to relevant files (skip lock files, generated code, etc.)
  const relevantFiles = files.filter((f) => {
    const skip = [
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      '.min.js',
      '.min.css',
      '.map',
    ];
    return !skip.some((s) => f.filename.includes(s));
  });

  if (relevantFiles.length === 0) {
    return {
      findings: [],
      summary: 'No reviewable code changes found (only lock files or generated code).',
      confidence: 1.0,
      testCoverageAssessment: 'not-applicable',
    };
  }

  // Truncate patches if too large to fit in context
  const truncatedFiles = relevantFiles.map((f) => ({
    ...f,
    patch: f.patch && f.patch.length > 5000 ? f.patch.substring(0, 5000) + '\n... (truncated)' : f.patch,
  }));

  const prompt = buildPrompt(truncatedFiles, prTitle, prBody);

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  // Extract text content
  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from agent');
  }

  // Parse JSON response
  const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse agent response as JSON');
  }

  const result = JSON.parse(jsonMatch[0]) as AgentResult;

  // Validate and sanitize
  return {
    findings: Array.isArray(result.findings) ? result.findings : [],
    summary: result.summary || 'Analysis complete.',
    confidence: typeof result.confidence === 'number' ? Math.min(1, Math.max(0, result.confidence)) : 0.5,
    testCoverageAssessment: result.testCoverageAssessment || 'not-applicable',
  };
}

/**
 * Format agent findings as a GitHub-flavored markdown comment
 */
export function formatFindingsAsMarkdown(result: AgentResult): string {
  const severityEmoji = {
    error: '🔴',
    warning: '🟡',
    info: '🔵',
  };

  const typeLabel = {
    test: 'Test Coverage',
    quality: 'Code Quality',
    bug: 'Potential Bug',
    suggestion: 'Suggestion',
  };

  let md = `## 🤖 AI Code Review\n\n`;
  md += `${result.summary}\n\n`;

  if (result.findings.length === 0) {
    md += `✅ No issues found!\n`;
  } else {
    md += `### Findings\n\n`;

    for (const finding of result.findings) {
      const emoji = severityEmoji[finding.severity];
      const label = typeLabel[finding.type];
      const location = finding.file ? `\`${finding.file}${finding.line ? `:${finding.line}` : ''}\`` : '';

      md += `${emoji} **${label}**`;
      if (location) md += ` in ${location}`;
      md += `\n`;
      md += `> ${finding.message}\n`;
      if (finding.suggestion) {
        md += `>\n> 💡 ${finding.suggestion}\n`;
      }
      md += `\n`;
    }
  }

  // Test coverage badge
  const coverageBadge = {
    adequate: '✅ Adequate',
    'needs-improvement': '⚠️ Needs Improvement',
    missing: '❌ Missing',
    'not-applicable': '➖ N/A',
  };
  md += `---\n`;
  md += `**Test Coverage**: ${coverageBadge[result.testCoverageAssessment]}\n`;
  md += `**Confidence**: ${(result.confidence * 100).toFixed(0)}%\n`;

  return md;
}
