/**
 * Review Evaluator
 *
 * Scores Qwen review output quality automatically.
 * Used to measure prompt effectiveness and detect regressions.
 */

import type { AgentFinding, AgentOutput } from '../agents/base-agent.js';

/**
 * Per-agent evaluation breakdown.
 */
export interface AgentEval {
  agent: string;
  findingCount: number;
  groundedCount: number;
  vagueCount: number;
  jsonParsed: boolean;
  confidence: number;
}

/**
 * Overall evaluation result.
 */
export interface EvalResult {
  /** Overall quality score (0-100) */
  score: number;
  /** % of findings referencing files in the diff */
  groundingScore: number;
  /** % of findings that are specific (not vague) */
  specificityScore: number;
  /** % of findings that are unique (not near-duplicates) */
  duplicationScore: number;
  /** % of agents that produced valid JSON */
  jsonHealthScore: number;
  /** Number of likely false positives */
  falsePositiveCount: number;
  /** Total findings across all agents */
  totalFindings: number;
  /** Per-agent breakdown */
  agentEvals: AgentEval[];
  /** Human-readable issues found during evaluation */
  issues: string[];
}

/**
 * Expected outcome for a benchmark fixture.
 */
export interface BenchmarkExpectation {
  /** Fixture name */
  name: string;
  /** Path to diff file */
  diffPath: string;
  /** PR title for context */
  title: string;
  /** Min acceptable findings (inclusive) */
  minFindings: number;
  /** Max acceptable findings (inclusive) */
  maxFindings: number;
  /** Files that MUST be in the diff (for grounding validation) */
  diffFiles: string[];
  /** Categories that should NOT appear (mismatched for this diff) */
  unexpectedCategories?: string[];
}

/** Vague phrases that indicate low-quality findings */
const VAGUE_PHRASES = [
  'ensure',
  'consider',
  'should be well-tested',
  'make sure',
  'it is recommended',
  'best practice',
  'might want to',
  'could potentially',
  'may cause issues',
  'should be reviewed',
  'needs attention',
  'be careful',
  'keep in mind',
];

/**
 * Score grounding: what % of findings reference files actually in the diff.
 */
export function scoreGrounding(
  findings: AgentFinding[],
  diffFiles: string[]
): number {
  if (findings.length === 0) return 100;

  const diffSet = new Set(diffFiles);
  let grounded = 0;

  for (const f of findings) {
    if (!f.file) {
      // No file reference = ungrounded
      continue;
    }
    if (diffSet.has(f.file)) {
      grounded++;
    }
  }

  return Math.round((grounded / findings.length) * 100);
}

/**
 * Score specificity: what % of findings avoid vague phrases.
 */
export function scoreSpecificity(findings: AgentFinding[]): number {
  if (findings.length === 0) return 100;

  let specific = 0;

  for (const f of findings) {
    const lower = f.message.toLowerCase();
    const isVague = VAGUE_PHRASES.some((phrase) => lower.includes(phrase));
    if (!isVague) {
      specific++;
    }
  }

  return Math.round((specific / findings.length) * 100);
}

/**
 * Score duplication: what % of findings are unique (not near-duplicates).
 * Uses simple message similarity check.
 */
export function scoreDuplication(findings: AgentFinding[]): number {
  if (findings.length <= 1) return 100;

  const seen: string[] = [];
  let unique = 0;

  for (const f of findings) {
    const normalized = f.message.toLowerCase().trim();
    const isDuplicate = seen.some(
      (s) => normalized.includes(s) || s.includes(normalized) || jaccardSimilarity(s, normalized) > 0.7
    );

    if (!isDuplicate) {
      unique++;
      seen.push(normalized);
    }
  }

  return Math.round((unique / findings.length) * 100);
}

/**
 * Jaccard similarity on word sets.
 */
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Score JSON health: what % of agents produced valid JSON.
 */
export function scoreJsonHealth(agentOutputs: AgentOutput[]): number {
  if (agentOutputs.length === 0) return 100;

  let healthy = 0;
  for (const output of agentOutputs) {
    // An agent that failed to parse JSON will have confidence 0 and
    // a summary starting with "Failed to parse"
    const failed =
      output.confidence === 0 &&
      output.summary.toLowerCase().includes('failed to parse');
    if (!failed) {
      healthy++;
    }
  }

  return Math.round((healthy / agentOutputs.length) * 100);
}

/**
 * Count likely false positives using heuristics.
 */
export function countFalsePositives(
  findings: AgentFinding[],
  diffFiles: string[]
): { count: number; reasons: string[] } {
  const diffSet = new Set(diffFiles);
  let count = 0;
  const reasons: string[] = [];

  for (const f of findings) {
    // Finding references file not in diff
    if (f.file && !diffSet.has(f.file)) {
      count++;
      reasons.push(`Hallucinated file: ${f.file} (not in diff)`);
      continue;
    }

    // Generic advice with no file reference
    if (!f.file && isGenericAdvice(f.message)) {
      count++;
      reasons.push(`Generic advice without file reference: "${truncate(f.message, 60)}"`);
      continue;
    }

    // CSRF/XSS in a CLI tool (common false positive)
    if (
      f.category.toLowerCase().includes('csrf') ||
      (f.category.toLowerCase().includes('xss') && diffFiles.every((df) => !df.includes('html') && !df.includes('template')))
    ) {
      count++;
      reasons.push(`Mismatched category "${f.category}" for non-web codebase`);
      continue;
    }
  }

  return { count, reasons };
}

function isGenericAdvice(message: string): boolean {
  const lower = message.toLowerCase();
  const genericIndicators = [
    'ensure adequate test coverage',
    'should be well-tested',
    'consider adding validation',
    'follow best practices',
    'should be documented',
    'add proper error handling',
  ];
  return genericIndicators.some((g) => lower.includes(g));
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.substring(0, maxLen) + '...' : s;
}

/**
 * Evaluate a set of findings and agent outputs.
 */
export function evaluateFindings(
  findings: AgentFinding[],
  diffFiles: string[],
  agentOutputs: AgentOutput[]
): EvalResult {
  const issues: string[] = [];

  const groundingScore = scoreGrounding(findings, diffFiles);
  const specificityScore = scoreSpecificity(findings);
  const duplicationScore = scoreDuplication(findings);
  const jsonHealthScore = scoreJsonHealth(agentOutputs);
  const { count: falsePositiveCount, reasons: fpReasons } =
    countFalsePositives(findings, diffFiles);

  issues.push(...fpReasons);

  if (groundingScore < 100) {
    issues.push(`Grounding: ${100 - groundingScore}% of findings reference files not in the diff`);
  }
  if (specificityScore < 80) {
    issues.push(`Specificity: ${100 - specificityScore}% of findings use vague language`);
  }
  if (duplicationScore < 80) {
    issues.push(`Duplication: ${100 - duplicationScore}% of findings appear to be duplicates`);
  }
  if (jsonHealthScore < 100) {
    issues.push(`JSON health: ${100 - jsonHealthScore}% of agents failed to produce valid JSON`);
  }

  // Per-agent breakdown
  const agentEvals: AgentEval[] = agentOutputs.map((output) => {
    const agentFindings = findings.filter((f) => f.agent === output.agent);
    const diffSet = new Set(diffFiles);

    return {
      agent: output.agent,
      findingCount: agentFindings.length,
      groundedCount: agentFindings.filter((f) => f.file && diffSet.has(f.file)).length,
      vagueCount: agentFindings.filter((f) =>
        VAGUE_PHRASES.some((p) => f.message.toLowerCase().includes(p))
      ).length,
      jsonParsed: !(output.confidence === 0 && output.summary.toLowerCase().includes('failed to parse')),
      confidence: output.confidence,
    };
  });

  // Overall score: weighted average
  const score = Math.round(
    groundingScore * 0.3 +
    specificityScore * 0.2 +
    duplicationScore * 0.15 +
    jsonHealthScore * 0.15 +
    Math.max(0, 100 - falsePositiveCount * 20) * 0.2
  );

  return {
    score,
    groundingScore,
    specificityScore,
    duplicationScore,
    jsonHealthScore,
    falsePositiveCount,
    totalFindings: findings.length,
    agentEvals,
    issues,
  };
}

/**
 * Format an EvalResult as a human-readable report.
 */
export function formatEvalReport(result: EvalResult): string {
  const lines: string[] = [];

  lines.push('=== Review Quality Report ===');
  lines.push('');
  lines.push(`Overall Score: ${result.score}/100`);
  lines.push(`Total Findings: ${result.totalFindings}`);
  lines.push(`False Positives: ${result.falsePositiveCount}`);
  lines.push('');
  lines.push('--- Scores ---');
  lines.push(`  Grounding:   ${result.groundingScore}%  (files in diff)`);
  lines.push(`  Specificity: ${result.specificityScore}%  (not vague)`);
  lines.push(`  Duplication: ${result.duplicationScore}%  (unique findings)`);
  lines.push(`  JSON Health: ${result.jsonHealthScore}%  (agents parsed OK)`);
  lines.push('');
  lines.push('--- Per-Agent ---');

  for (const ae of result.agentEvals) {
    const status = ae.jsonParsed ? 'OK' : 'FAIL';
    lines.push(
      `  ${ae.agent.padEnd(22)} findings=${ae.findingCount} grounded=${ae.groundedCount} vague=${ae.vagueCount} json=${status} conf=${(ae.confidence * 100).toFixed(0)}%`
    );
  }

  if (result.issues.length > 0) {
    lines.push('');
    lines.push('--- Issues ---');
    for (const issue of result.issues) {
      lines.push(`  - ${issue}`);
    }
  }

  return lines.join('\n');
}
