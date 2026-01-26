/**
 * Response Executor
 *
 * Orchestrates the response flow for replying to Qwen's PR reviews:
 * - Execute responses (reactions and comments for each finding)
 * - Execute merge (approve and merge PR)
 * - Sync to MCP (log learnings to repo-manager)
 */

import type { Octokit } from '@octokit/rest';
import type { PRContext, ReactionType } from './github.js';
import {
  addCommentReaction,
  replyToIssueComment,
  postReviewComment,
  mergePR,
  getPRMergeStatus,
  deleteBranch,
  getPRHeadBranch,
} from './github.js';
import {
  type ResponseSession,
  type FindingResponse,
  type MergeOptions,
  ACTION_REACTIONS,
  canMerge,
  formatResponseSummary,
  formatInlineReply,
} from './review-response.js';

/**
 * Result of executing responses
 */
export interface ExecuteResponsesResult {
  reactionsAdded: number;
  commentsPosted: number;
  summaryCommentId?: number;
  errors: string[];
}

/**
 * Result of a merge operation
 */
export interface ExecuteMergeResult {
  merged: boolean;
  sha?: string;
  branchDeleted: boolean;
  message?: string;
}

/**
 * MCP sync result
 */
export interface SyncToMCPResult {
  learningsReinforced: number;
  decisionsLogged: number;
  reviewLogged: boolean;
}

/**
 * Execute all responses for a session
 *
 * Posts reactions and comments for each finding response.
 */
export async function executeResponses(
  octokit: Octokit,
  context: PRContext,
  session: ResponseSession
): Promise<ExecuteResponsesResult> {
  const result: ExecuteResponsesResult = {
    reactionsAdded: 0,
    commentsPosted: 0,
    errors: [],
  };

  // Add reactions for each response
  for (const response of session.responses) {
    try {
      const reaction = ACTION_REACTIONS[response.action] as ReactionType;
      await addCommentReaction(octokit, context, session.reviewCommentId, reaction);
      result.reactionsAdded++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Failed to add reaction for finding #${response.finding.index}: ${msg}`);
    }

    // Post inline reply if there's a comment
    if (response.comment || response.action === 'accept' || response.action === 'todo') {
      try {
        const replyBody = formatInlineReply(response.action, response.comment);
        await replyToIssueComment(octokit, context, replyBody);
        result.commentsPosted++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Failed to post reply for finding #${response.finding.index}: ${msg}`);
      }
    }
  }

  // Post summary comment
  try {
    const summary = formatResponseSummary(session.responses);
    const summaryId = await replyToIssueComment(octokit, context, summary);
    result.summaryCommentId = summaryId;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    result.errors.push(`Failed to post summary comment: ${msg}`);
  }

  return result;
}

/**
 * Execute merge operation
 *
 * Checks merge guard, approves PR, merges, and optionally deletes branch.
 */
export async function executeMerge(
  octokit: Octokit,
  context: PRContext,
  responses: FindingResponse[],
  options: MergeOptions = { method: 'squash' }
): Promise<ExecuteMergeResult> {
  // Check merge guard - block if critical findings unaddressed
  const mergeCheck = canMerge(responses);
  if (!mergeCheck.allowed) {
    return {
      merged: false,
      branchDeleted: false,
      message: mergeCheck.reason,
    };
  }

  // Check GitHub merge status
  const status = await getPRMergeStatus(octokit, context);
  if (!status.mergeable) {
    return {
      merged: false,
      branchDeleted: false,
      message: `PR is not mergeable. State: ${status.state} (${status.mergeableState})`,
    };
  }

  // Approve the PR first
  try {
    await postReviewComment(octokit, context, 'Approved after addressing AI review findings.', 'APPROVE');
  } catch (error) {
    // Continue even if approval fails - might already be approved
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`Approval failed (continuing): ${msg}`);
  }

  // Merge the PR
  const mergeResult = await mergePR(octokit, context, {
    method: options.method,
    commitTitle: `Merge PR #${context.prNumber}`,
  });

  if (!mergeResult.merged) {
    return {
      merged: false,
      branchDeleted: false,
      message: mergeResult.message,
    };
  }

  // Delete branch if requested
  let branchDeleted = false;
  if (options.deleteBranch) {
    const branch = await getPRHeadBranch(octokit, context);
    branchDeleted = await deleteBranch(octokit, context.owner, context.repo, branch);
  }

  return {
    merged: true,
    sha: mergeResult.sha,
    branchDeleted,
    message: 'PR merged successfully',
  };
}

/**
 * Sync session results to repo-manager MCP
 *
 * Logs learnings, decisions, and review summary.
 *
 * Note: This function returns the data that should be passed to MCP tools.
 * The actual MCP calls are made by Claude Code using the mcp__repo-manager__ tools.
 */
export function prepareMCPSync(
  session: ResponseSession,
  mergeResult?: ExecuteMergeResult
): {
  learnings: Array<{ pattern: string; context: string }>;
  decision?: { title: string; rationale: string; outcome: string };
  review: { prNumber: number; summary: string; stats: Record<string, number> };
} {
  const learnings: Array<{ pattern: string; context: string }> = [];

  // Collect learnings from accepted findings
  for (const response of session.responses) {
    if (response.action === 'accept') {
      learnings.push({
        pattern: `[${response.finding.agent}/${response.finding.category}] ${response.finding.message}`,
        context: response.comment || 'Accepted finding from AI review',
      });
    }
  }

  // Prepare decision if merged
  let decision: { title: string; rationale: string; outcome: string } | undefined;
  if (mergeResult?.merged) {
    decision = {
      title: `Merged PR #${session.prNumber} after AI review`,
      rationale: `Addressed ${session.responses.filter((r) => r.action === 'accept').length} findings`,
      outcome: `Merged with SHA ${mergeResult.sha}`,
    };
  }

  // Prepare review summary
  const stats = {
    total: session.findings.length,
    accepted: session.responses.filter((r) => r.action === 'accept').length,
    todo: session.responses.filter((r) => r.action === 'todo').length,
    ignored: session.responses.filter((r) => r.action === 'ignore').length,
    commented: session.responses.filter((r) => r.action === 'comment').length,
  };

  const review = {
    prNumber: session.prNumber,
    summary: `Responded to ${stats.total} findings: ${stats.accepted} accepted, ${stats.todo} deferred, ${stats.ignored} acknowledged, ${stats.commented} discussed`,
    stats,
  };

  return { learnings, decision, review };
}
