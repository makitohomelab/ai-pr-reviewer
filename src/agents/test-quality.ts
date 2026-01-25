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
  priority: 'critical' | 'high' | 'medium';
  file?: string;
  line?: number;
  message: string;
}

export interface AgentResult {
  findings: QualityFinding[];
  summary: string;
  confidence: number; // 0-1 score of how confident the agent is in its analysis
}

export type PRImportance = 'low' | 'medium' | 'high';

interface PRMetrics {
  filesChanged: number;
  linesChanged: number;
  hasSensitiveFiles: boolean;
}

const SENSITIVE_PATTERNS = [
  /auth/i, /login/i, /password/i, /secret/i, /token/i, /key/i,
  /security/i, /crypto/i, /encrypt/i, /\.env/, /config/i,
  /payment/i, /billing/i, /credit/i, /api/i, /middleware/i,
];

export function calculateImportance(files: FileChange[]): PRImportance {
  const metrics: PRMetrics = {
    filesChanged: files.length,
    linesChanged: files.reduce((sum, f) => sum + f.additions + f.deletions, 0),
    hasSensitiveFiles: files.some((f) =>
      SENSITIVE_PATTERNS.some((p) => p.test(f.filename))
    ),
  };

  // High importance: sensitive files, large changes, or many files
  if (metrics.hasSensitiveFiles || metrics.linesChanged > 500 || metrics.filesChanged > 10) {
    return 'high';
  }
  // Medium importance: moderate changes
  if (metrics.linesChanged > 100 || metrics.filesChanged > 3) {
    return 'medium';
  }
  return 'low';
}

function buildSystemPrompt(importance: PRImportance): string {
  const charLimits: Record<PRImportance, number> = {
    low: 100,
    medium: 150,
    high: 250,
  };
  const charLimit = charLimits[importance];

  return `You are a focused code reviewer. Analyze changes in priority order:

1. **critical** - Security issues: injection, auth bypass, secrets exposure, unsafe deserialization
2. **high** - Breaking changes: API signature changes, removed functionality, behavior changes
3. **medium** - Test gaps and blocking quality issues: untested new code paths, obvious bugs

Rules:
- Return max 5 findings, highest priority first
- Keep each message under ${charLimit} characters
- Skip style/formatting issues entirely
- Only report issues you're confident about

Respond with JSON:
{
  "findings": [
    {"priority": "critical"|"high"|"medium", "file": "path.ts", "line": 42, "message": "Brief issue"}
  ],
  "summary": "One sentence assessment",
  "confidence": 0.85
}`;
}

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
      summary: 'No reviewable code changes found.',
      confidence: 1.0,
    };
  }

  // Truncate patches if too large to fit in context
  const truncatedFiles = relevantFiles.map((f) => ({
    ...f,
    patch: f.patch && f.patch.length > 5000 ? f.patch.substring(0, 5000) + '\n... (truncated)' : f.patch,
  }));

  const prompt = buildPrompt(truncatedFiles, prTitle, prBody);
  const importance = calculateImportance(relevantFiles);
  const systemPrompt = buildSystemPrompt(importance);

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 4096,
    system: systemPrompt,
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
    findings: Array.isArray(result.findings) ? result.findings.slice(0, 5) : [],
    summary: result.summary || 'Analysis complete.',
    confidence: typeof result.confidence === 'number' ? Math.min(1, Math.max(0, result.confidence)) : 0.5,
  };
}

/**
 * Format agent findings as a GitHub-flavored markdown comment
 */
export function formatFindingsAsMarkdown(result: AgentResult): string {
  const priorityLabel = {
    critical: 'Security',
    high: 'Breaking',
    medium: 'Tests/Quality',
  };

  let md = `## AI Review\n\n`;

  // Group findings by priority
  const critical = result.findings.filter((f) => f.priority === 'critical');
  const high = result.findings.filter((f) => f.priority === 'high');
  const medium = result.findings.filter((f) => f.priority === 'medium');

  // Security
  if (critical.length > 0) {
    md += `**Security**: ${critical.map((f) => formatFinding(f)).join('; ')}\n`;
  } else {
    md += `**Security**: None found\n`;
  }

  // Breaking changes
  if (high.length > 0) {
    md += `**Breaking**: ${high.map((f) => formatFinding(f)).join('; ')}\n`;
  } else {
    md += `**Breaking**: None found\n`;
  }

  // Tests/Quality
  if (medium.length > 0) {
    md += `**Tests**: ${medium.map((f) => formatFinding(f)).join('; ')}\n`;
  } else {
    md += `**Tests**: No gaps found\n`;
  }

  md += `\n---\n`;
  md += `${result.findings.length} issues | Confidence: ${(result.confidence * 100).toFixed(0)}%`;

  return md;
}

function formatFinding(f: QualityFinding): string {
  const location = f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`` : '';
  return location ? `${f.message} in ${location}` : f.message;
}
