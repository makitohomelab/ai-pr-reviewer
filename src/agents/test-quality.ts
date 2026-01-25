/**
 * Test & Quality Agent
 *
 * Specialized subagent that analyzes code changes for:
 * - Test coverage gaps
 * - Code quality issues
 * - Best practice violations
 * - Potential bugs
 *
 * Uses fast tier models for cost efficiency.
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

export interface AgentResult {
  findings: QualityFinding[];
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

function buildSystemPrompt(): string {
  return `You are a focused code reviewer. Analyze changes in priority order:

1. **critical** - Security issues: injection, auth bypass, secrets exposure, unsafe deserialization
2. **high** - Breaking changes: API signature changes, removed functionality, behavior changes
3. **medium** - Test gaps and blocking quality issues: untested new code paths, obvious bugs

Rules:
- Return max 5 findings, highest priority first
- Skip style/formatting issues entirely
- Only report issues you're confident about
- Be thorough in your explanations

Respond with JSON:
{
  "findings": [
    {"priority": "critical"|"high"|"medium", "file": "path.ts", "line": 42, "message": "Detailed explanation of the issue"}
  ],
  "summary": "Assessment of the changes",
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

  const llmStart = performance.now();
  const response = await provider.chat(
    {
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4096,
    },
    'fast'
  );
  const llmLatencyMs = Math.round(performance.now() - llmStart);

  // Debug logging
  const debug = process.env.DEBUG_AI_REVIEW === 'true';
  if (debug) {
    console.log('\n📝 DEBUG: Raw LLM Response:');
    console.log('─'.repeat(60));
    console.log(response.content);
    console.log('─'.repeat(60));
    console.log(`Response length: ${response.content.length} chars`);
    console.log(`Tokens: ${response.usage?.inputTokens} in / ${response.usage?.outputTokens} out\n`);
  }

  // Parse JSON response - handle markdown code blocks and extract valid JSON
  let jsonContent = response.content;

  // Strip markdown code blocks if present
  const codeBlockMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonContent = codeBlockMatch[1];
  }

  // Find the JSON object
  const jsonMatch = jsonContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse agent response as JSON');
  }

  // Extract just the first complete JSON object by balancing braces
  let jsonText = jsonMatch[0];
  let depth = 0;
  let endIndex = 0;
  for (let i = 0; i < jsonText.length; i++) {
    if (jsonText[i] === '{') depth++;
    else if (jsonText[i] === '}') {
      depth--;
      if (depth === 0) {
        endIndex = i + 1;
        break;
      }
    }
  }
  if (endIndex > 0) {
    jsonText = jsonText.substring(0, endIndex);
  }

  // Try to parse, with fallback to repair common LLM JSON errors
  let result: AgentResult;
  try {
    result = JSON.parse(jsonText) as AgentResult;
  } catch {
    // Attempt to repair common JSON errors from LLMs
    let repaired = jsonText
      // Replace single quotes with double quotes (but not inside strings)
      .replace(/'/g, '"')
      // Remove trailing commas before } or ]
      .replace(/,\s*([}\]])/g, '$1')
      // Quote unquoted property names
      .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');

    try {
      result = JSON.parse(repaired) as AgentResult;
      if (debug) {
        console.log('📝 DEBUG: Used repaired JSON');
      }
    } catch (e) {
      if (debug) {
        console.log('📝 DEBUG: JSON repair failed');
        console.log('Extracted JSON text:', jsonText.substring(0, 500));
      }
      throw new Error(`Failed to parse agent response as JSON: ${e}`);
    }
  }

  if (debug) {
    console.log('📝 DEBUG: Parsed Result:');
    console.log(`  Findings: ${result.findings?.length || 0}`);
    result.findings?.forEach((f, i) => {
      console.log(`    ${i + 1}. [${f.priority}] ${f.file || 'general'}: ${f.message?.substring(0, 100)}`);
    });
    console.log(`  Summary: ${result.summary?.substring(0, 100)}`);
    console.log(`  Confidence: ${result.confidence}`);
  }

  const totalLatencyMs = Math.round(performance.now() - totalStart);

  // Validate and sanitize
  return {
    findings: Array.isArray(result.findings) ? result.findings.slice(0, 5) : [],
    summary: result.summary || 'Analysis complete.',
    confidence: typeof result.confidence === 'number' ? Math.min(1, Math.max(0, result.confidence)) : 0.5,
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

  // Add benchmark data if available
  if (result.benchmark) {
    const b = result.benchmark;
    md += `\n\n<details>\n<summary>Benchmark</summary>\n\n`;
    md += `| Metric | Value |\n|--------|-------|\n`;
    md += `| Model | \`${b.model}\` |\n`;
    md += `| LLM Latency | ${(b.llmLatencyMs / 1000).toFixed(2)}s |\n`;
    md += `| Total Latency | ${(b.totalLatencyMs / 1000).toFixed(2)}s |\n`;
    if (b.inputTokens !== undefined) {
      md += `| Input Tokens | ${b.inputTokens.toLocaleString()} |\n`;
    }
    if (b.outputTokens !== undefined) {
      md += `| Output Tokens | ${b.outputTokens.toLocaleString()} |\n`;
    }
    md += `\n</details>`;
  }

  return md;
}

function formatFinding(f: QualityFinding): string {
  const location = f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`` : '';
  return location ? `${f.message} in ${location}` : f.message;
}
