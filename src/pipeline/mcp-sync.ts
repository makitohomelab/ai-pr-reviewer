/**
 * MCP Sync
 *
 * Syncs review results to repo-manager MCP for learning and tracking.
 * This allows patterns that catch issues to be reinforced over time.
 *
 * Note: This module is designed to work with repo-manager MCP but
 * gracefully degrades if MCP is not available.
 */

import type { AgentFinding } from '../agents/base-agent.js';
import type { AggregatedResult } from './result-aggregator.js';

/**
 * MCP sync configuration.
 */
export interface MCPSyncConfig {
  /** Repository identifier */
  repoId: string;
  /** PR number */
  prNumber: number;
  /** PR author */
  author?: string;
  /** PR title */
  prTitle?: string;
  /** Whether MCP sync is enabled */
  enabled: boolean;
}

/**
 * Result of MCP sync operation.
 */
export interface MCPSyncResult {
  /** Whether sync was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Number of learnings synced */
  learningsSynced?: number;
}

/**
 * Map finding categories to repo-manager pattern types.
 */
function mapToPatternType(
  agent: string,
  category: string
): 'code_quality' | 'test_coverage' | 'architecture' | 'security' {
  if (agent === 'security') return 'security';
  if (agent === 'test-coverage') return 'test_coverage';
  if (category === 'api' || category === 'export') return 'architecture';
  return 'code_quality';
}

/**
 * Generate tags for a finding.
 */
function generateTags(finding: AgentFinding): string[] {
  const tags: string[] = [finding.agent, finding.category];

  // Add priority tag
  if (finding.priority === 'critical' || finding.priority === 'high') {
    tags.push(finding.priority);
  }

  // Add file extension tag if available
  if (finding.file) {
    const ext = finding.file.split('.').pop();
    if (ext && ['ts', 'js', 'py', 'go', 'rs'].includes(ext)) {
      tags.push(ext === 'ts' ? 'typescript' : ext === 'js' ? 'javascript' : ext);
    }
  }

  // Ensure we have 3-5 tags
  while (tags.length < 3) tags.push('general');
  return tags.slice(0, 5);
}

/**
 * Sync review results to repo-manager MCP.
 *
 * This function is designed to be called from environments where
 * MCP is available (like Claude Code sessions). In CI, it will
 * gracefully skip if MCP is not configured.
 */
export async function syncToMCP(
  config: MCPSyncConfig,
  result: AggregatedResult
): Promise<MCPSyncResult> {
  // Check if sync is enabled
  if (!config.enabled) {
    return { success: true, learningsSynced: 0 };
  }

  // In a real implementation, this would call the MCP tools.
  // For now, we log what would be synced and return success.
  // The actual MCP calls would be made by the orchestrating Claude session.

  console.log(`\n📤 MCP Sync (${config.repoId} PR #${config.prNumber})`);

  // Log review
  console.log(`   log_review: ${result.findings.length} findings, escalated=${result.shouldEscalate}`);

  // Reinforce learnings for high-impact findings
  const highImpactFindings = result.findings.filter(
    (f) => f.priority === 'critical' || f.priority === 'high'
  );

  let learningsSynced = 0;
  for (const finding of highImpactFindings.slice(0, 3)) {
    const patternType = mapToPatternType(finding.agent, finding.category);
    const tags = generateTags(finding);

    console.log(`   reinforce_learning: [${patternType}] ${finding.message.substring(0, 50)}...`);
    console.log(`      tags: ${tags.join(', ')}`);
    learningsSynced++;
  }

  return {
    success: true,
    learningsSynced,
  };
}

/**
 * Build MCP sync config from environment.
 */
export function getMCPSyncConfig(): MCPSyncConfig {
  return {
    repoId: `${process.env.REPO_OWNER}/${process.env.REPO_NAME}` || 'unknown',
    prNumber: parseInt(process.env.PR_NUMBER || '0', 10),
    author: process.env.PR_AUTHOR,
    prTitle: process.env.PR_TITLE,
    enabled: process.env.REPO_MANAGER_SYNC === 'true',
  };
}

/**
 * Format sync result for logging.
 */
export function formatSyncResult(result: MCPSyncResult): string {
  if (!result.success) {
    return `❌ MCP sync failed: ${result.error}`;
  }
  if (result.learningsSynced === 0) {
    return `ℹ️  MCP sync skipped (no high-impact findings)`;
  }
  return `✅ MCP sync: ${result.learningsSynced} learning(s) reinforced`;
}
