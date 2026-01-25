/**
 * Test & Quality Agent
 *
 * Specialized subagent that analyzes code changes for:
 * - Security vulnerabilities
 * - Breaking changes
 * - Bugs and test gaps
 *
 * Optimized for Qwen 2.5 Coder with structured output.
 */

import type { ModelProvider } from '../lib/model-provider.js';
import type { FileChange } from '../lib/github.js';

export interface QualityFinding {
  priority: 'critical' | 'high' | 'medium';
  file?: string;
  line?: number;
  message: string;
}

export interface BenchmarkData {
  llmLatencyMs: number;
  totalLatencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  model: string;
}

export interface ReviewedArea {
  area: 'security' | 'breaking' | 'quality';
  status: 'pass' | 'warn' | 'fail';
  details: string; // What was checked and why it passed/failed
}

export interface AgentResult {
  findings: QualityFinding[];
  reviewed: ReviewedArea[]; // Explanation of what was analyzed
  summary: string;
  confidence: number; // 0-1 score of how confident the agent is in its analysis
  benchmark?: BenchmarkData;
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

/**
 * JSON Schema for structured output.
 * Ollama constrains generation to match this schema exactly.
 */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          priority: { type: 'string', enum: ['critical', 'high', 'medium'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          message: { type: 'string' },
        },
        required: ['priority', 'message'],
      },
    },
    reviewed: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          area: { type: 'string', enum: ['security', 'breaking', 'quality'] },
          status: { type: 'string', enum: ['pass', 'warn', 'fail'] },
          details: { type: 'string' },
        },
        required: ['area', 'status', 'details'],
      },
    },
    summary: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['findings', 'reviewed', 'summary', 'confidence'],
};

/**
 * System prompt optimized for Qwen 2.5 Coder.
 * - Direct, focused instructions
 * - Leverages Qwen's code analysis training
 * - Requires explanation of what was reviewed
 */
function buildSystemPrompt(): string {
  return `You are a senior code reviewer. Analyze the diff and provide a detailed review.

REVIEW AREAS (you must analyze all three):
1. security: Check for injection, auth bypass, secrets exposure, unsafe deserialization, XSS, CSRF
2. breaking: Check for API changes, removed exports, signature changes, behavior changes affecting callers
3. quality: Check for null risks, race conditions, missing error handling, resource leaks, untested paths

For each area, explain WHAT you checked and WHY it passed or failed. Be specific about the code.

FINDINGS (if any issues found):
- priority: critical (security), high (breaking), medium (quality)
- Include file path and line number
- Max 5 issues, most severe first

Skip style/formatting. Focus on correctness and safety.`;
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

  return `## PR: ${prTitle}

${prBody || '(No description)'}

## Changed Files

${fileSummaries.join('\n\n')}`;
}

export async function runTestQualityAgent(
  provider: ModelProvider,
  files: FileChange[],
  prTitle: string,
  prBody: string
): Promise<AgentResult> {
  const totalStart = performance.now();

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
      reviewed: [
        { area: 'security', status: 'pass', details: 'No code changes to review (only lock files or generated code)' },
        { area: 'breaking', status: 'pass', details: 'No API or behavior changes detected' },
        { area: 'quality', status: 'pass', details: 'No code quality issues to check' },
      ],
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
  const systemPrompt = buildSystemPrompt();

  const debug = process.env.DEBUG_AI_REVIEW === 'true';

  const llmStart = performance.now();
  const response = await provider.chat(
    {
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2048,
      jsonSchema: RESPONSE_SCHEMA,
      temperature: 0,
    },
    'fast'
  );
  const llmLatencyMs = Math.round(performance.now() - llmStart);

  if (debug) {
    console.log('\n📝 DEBUG: Raw LLM Response:');
    console.log('─'.repeat(60));
    console.log(response.content);
    console.log('─'.repeat(60));
    console.log(`Response length: ${response.content.length} chars`);
    console.log(`Tokens: ${response.usage?.inputTokens} in / ${response.usage?.outputTokens} out\n`);
  }

  // Parse JSON - schema-constrained output should be valid
  let result: AgentResult;
  try {
    result = JSON.parse(response.content) as AgentResult;
  } catch (e) {
    if (debug) {
      console.log('📝 DEBUG: JSON parse failed, attempting recovery');
    }
    // Fallback: try to extract JSON if model added extra text
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      result = JSON.parse(jsonMatch[0]) as AgentResult;
    } else {
      throw new Error(`Failed to parse response as JSON: ${e}`);
    }
  }

  // Validate and normalize findings
  const findings: QualityFinding[] = [];
  if (Array.isArray(result.findings)) {
    for (const f of result.findings.slice(0, 5)) {
      const priority = ['critical', 'high', 'medium'].includes(f.priority) ? f.priority : 'medium';
      findings.push({
        priority: priority as 'critical' | 'high' | 'medium',
        file: f.file,
        line: typeof f.line === 'number' ? f.line : undefined,
        message: String(f.message || 'No details'),
      });
    }
  }

  // Parse reviewed areas
  const reviewed: ReviewedArea[] = [];
  if (Array.isArray(result.reviewed)) {
    for (const r of result.reviewed) {
      if (['security', 'breaking', 'quality'].includes(r.area)) {
        reviewed.push({
          area: r.area as 'security' | 'breaking' | 'quality',
          status: ['pass', 'warn', 'fail'].includes(r.status) ? r.status as 'pass' | 'warn' | 'fail' : 'pass',
          details: String(r.details || 'No details provided'),
        });
      }
    }
  }

  const summary = typeof result.summary === 'string' ? result.summary : 'Analysis complete.';
  const confidence = typeof result.confidence === 'number'
    ? Math.min(1, Math.max(0, result.confidence))
    : 0.8;

  if (debug) {
    console.log('📝 DEBUG: Parsed Result:');
    console.log(`  Findings: ${findings.length}`);
    findings.forEach((f, i) => {
      console.log(`    ${i + 1}. [${f.priority}] ${f.file || 'general'}: ${f.message?.substring(0, 100)}`);
    });
    console.log(`  Summary: ${summary.substring(0, 100)}`);
    console.log(`  Confidence: ${confidence}`);
  }

  const totalLatencyMs = Math.round(performance.now() - totalStart);

  return {
    findings,
    reviewed,
    summary,
    confidence,
    benchmark: {
      llmLatencyMs,
      totalLatencyMs,
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
      model: provider.getModelName('fast'),
    },
  };
}

/**
 * Format agent findings as a GitHub-flavored markdown comment
 */
export function formatFindingsAsMarkdown(result: AgentResult): string {
  const statusIcon = (status: string) => {
    switch (status) {
      case 'pass': return '✅';
      case 'warn': return '⚠️';
      case 'fail': return '❌';
      default: return '•';
    }
  };

  const areaLabel = (area: string) => {
    switch (area) {
      case 'security': return 'Security';
      case 'breaking': return 'Breaking Changes';
      case 'quality': return 'Code Quality';
      default: return area;
    }
  };

  let md = `## AI Review\n\n`;

  // Show reviewed areas with explanations
  if (result.reviewed && result.reviewed.length > 0) {
    for (const r of result.reviewed) {
      md += `${statusIcon(r.status)} **${areaLabel(r.area)}**: ${r.details}\n\n`;
    }
  } else {
    // Fallback to old format if no reviewed data
    const critical = result.findings.filter((f) => f.priority === 'critical');
    const high = result.findings.filter((f) => f.priority === 'high');
    const medium = result.findings.filter((f) => f.priority === 'medium');

    md += critical.length > 0
      ? `❌ **Security**: ${critical.map((f) => formatFinding(f)).join('; ')}\n\n`
      : `✅ **Security**: No vulnerabilities found\n\n`;

    md += high.length > 0
      ? `❌ **Breaking Changes**: ${high.map((f) => formatFinding(f)).join('; ')}\n\n`
      : `✅ **Breaking Changes**: No breaking changes detected\n\n`;

    md += medium.length > 0
      ? `⚠️ **Code Quality**: ${medium.map((f) => formatFinding(f)).join('; ')}\n\n`
      : `✅ **Code Quality**: No issues found\n\n`;
  }

  // Show findings if any
  if (result.findings.length > 0) {
    md += `### Issues Found\n\n`;
    for (const f of result.findings) {
      const icon = f.priority === 'critical' ? '🔴' : f.priority === 'high' ? '🟠' : '🟡';
      const location = f.file ? ` in \`${f.file}${f.line ? `:${f.line}` : ''}\`` : '';
      md += `${icon} **${f.priority}**: ${f.message}${location}\n\n`;
    }
  }

  md += `---\n`;
  md += `**Summary**: ${result.summary}\n\n`;
  md += `Confidence: ${(result.confidence * 100).toFixed(0)}%`;

  // Add benchmark data if available
  if (result.benchmark) {
    const b = result.benchmark;
    md += ` | Model: \`${b.model}\` | ${(b.llmLatencyMs / 1000).toFixed(1)}s`;
  }

  return md;
}

function formatFinding(f: QualityFinding): string {
  const location = f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`` : '';
  return location ? `${f.message} in ${location}` : f.message;
}
