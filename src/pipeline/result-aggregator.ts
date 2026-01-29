/**
 * Result Aggregator
 *
 * Aggregates and formats findings from multiple agents,
 * deduplicating and prioritizing for the final PR comment.
 */

import type { AgentFinding, AgentOutput } from '../agents/base-agent.js';
import type { FileChange } from '../lib/github.js';
import type { PipelineResult } from './pipeline-orchestrator.js';
import { deduplicateFindings } from '../lib/deduplication.js';

/**
 * Aggregated review result.
 */
export interface AggregatedResult {
  /** Deduplicated findings */
  findings: AgentFinding[];
  /** Summary for PR comment */
  summary: string;
  /** Overall confidence */
  confidence: number;
  /** Whether escalation is recommended */
  shouldEscalate: boolean;
  /** Reasons for escalation */
  escalationReasons: string[];
}

// Deduplication now handled by src/lib/deduplication.ts

/**
 * Sort findings by priority and file.
 */
function sortFindings(findings: AgentFinding[]): AgentFinding[] {
  const priorityOrder = { critical: 0, high: 1, medium: 2 };

  return [...findings].sort((a, b) => {
    // First by priority
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;

    // Then by file
    const fileA = a.file || '';
    const fileB = b.file || '';
    return fileA.localeCompare(fileB);
  });
}

/**
 * Determine if escalation to human review is needed.
 */
function checkEscalation(
  findings: AgentFinding[],
  agentOutputs: AgentOutput[]
): { shouldEscalate: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // Check for critical findings
  const criticalCount = findings.filter(
    (f) => f.priority === 'critical'
  ).length;
  if (criticalCount > 0) {
    reasons.push(`${criticalCount} critical issue(s) detected`);
  }

  // Check for low confidence
  const lowConfidenceAgents = agentOutputs.filter((o) => o.confidence < 0.5);
  if (lowConfidenceAgents.length > 0) {
    reasons.push(
      `Low confidence from: ${lowConfidenceAgents.map((o) => o.agent).join(', ')}`
    );
  }

  // Check for security findings
  const securityFindings = findings.filter(
    (f) => f.agent === 'security' && f.priority !== 'medium'
  );
  if (securityFindings.length > 0) {
    reasons.push(`${securityFindings.length} security concern(s)`);
  }

  return {
    shouldEscalate: reasons.length > 0,
    reasons,
  };
}

/**
 * Filter out findings that reference files not present in the PR diff.
 */
export function filterUngroundedFindings(
  findings: AgentFinding[],
  diffFiles: FileChange[],
  verbose = false
): AgentFinding[] {
  if (diffFiles.length === 0) return findings;

  const diffFilenames = new Set(diffFiles.map((f) => f.filename));
  const filtered: AgentFinding[] = [];
  let droppedCount = 0;

  for (const finding of findings) {
    if (!finding.file || diffFilenames.has(finding.file)) {
      filtered.push(finding);
    } else {
      droppedCount++;
    }
  }

  if (verbose && droppedCount > 0) {
    console.log(`   Dropped ${droppedCount} finding(s) referencing files not in the diff`);
  }

  return filtered;
}

/**
 * Aggregate pipeline results into final format.
 */
export function aggregateResults(
  result: PipelineResult,
  diffFiles?: FileChange[]
): AggregatedResult {
  // Filter ungrounded findings if diff files provided
  let findings = result.findings;
  if (diffFiles && diffFiles.length > 0) {
    findings = filterUngroundedFindings(
      findings,
      diffFiles,
      process.env.DEBUG_AI_REVIEW === 'true'
    );
  }

  // Deduplicate and sort findings
  const deduplicated = deduplicateFindings(findings);
  const sorted = sortFindings(deduplicated);

  // Limit to top findings
  const topFindings = sorted.slice(0, 10);

  // Check escalation
  const { shouldEscalate, reasons } = checkEscalation(
    result.findings,
    result.agentOutputs
  );

  return {
    findings: topFindings,
    summary: result.summary,
    confidence: result.confidence,
    shouldEscalate,
    escalationReasons: reasons,
  };
}

/**
 * Format aggregated results as GitHub-flavored markdown.
 */
export function formatAsMarkdown(result: AggregatedResult): string {
  const sections: string[] = [];

  // Header
  sections.push('## AI Review');

  // Agent summaries
  sections.push(result.summary);

  // Findings
  if (result.findings.length > 0) {
    sections.push('### Issues Found\n');

    for (const finding of result.findings) {
      const icon =
        finding.priority === 'critical'
          ? '🔴'
          : finding.priority === 'high'
            ? '🟠'
            : '🟡';

      const location = finding.file
        ? ` in \`${finding.file}${finding.line ? `:${finding.line}` : ''}\``
        : '';

      let line = `${icon} **[${finding.agent}/${finding.category}]** ${finding.message}${location}`;

      if (finding.suggestion) {
        line += `\n   💡 *Suggestion: ${finding.suggestion}*`;
      }

      sections.push(line);
    }
  } else {
    sections.push('✅ No issues detected across all review areas.');
  }

  // Escalation notice
  if (result.shouldEscalate) {
    const reasons = result.escalationReasons.join(', ');
    sections.push(`\n---\n⚠️ **Needs human review**: ${reasons}`);
  }

  // Footer
  sections.push(`\n---`);
  sections.push(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);

  return sections.join('\n\n');
}

/**
 * Format as compact summary (for logging or brief display).
 */
export function formatAsCompactSummary(result: AggregatedResult): string {
  const critical = result.findings.filter(
    (f) => f.priority === 'critical'
  ).length;
  const high = result.findings.filter((f) => f.priority === 'high').length;
  const medium = result.findings.filter((f) => f.priority === 'medium').length;

  const parts: string[] = [];

  if (critical > 0) parts.push(`🔴 ${critical} critical`);
  if (high > 0) parts.push(`🟠 ${high} high`);
  if (medium > 0) parts.push(`🟡 ${medium} medium`);

  if (parts.length === 0) {
    return '✅ No issues found';
  }

  return parts.join(', ');
}
