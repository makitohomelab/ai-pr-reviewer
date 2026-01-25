/**
 * MCP Server definition for AI PR Reviewer
 *
 * Exposes tools for:
 * - Storing and retrieving learned patterns
 * - Logging reviews
 * - Getting repository context
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ReviewerDB } from './db.js';

export interface ServerContext {
  db: ReviewerDB;
}

export function createServer(db: ReviewerDB): { server: McpServer; context: ServerContext } {
  const server = new McpServer({
    name: 'ai-pr-reviewer',
    version: '0.1.0',
  });

  const context: ServerContext = { db };

  // Tool: Store a learned pattern
  server.tool(
    'store_learning',
    {
      repo: z.string().describe('Repository identifier (owner/name)'),
      pattern_type: z.enum(['code_quality', 'test_coverage', 'architecture', 'security']).describe('Type of pattern'),
      pattern: z.string().describe('The pattern or rule learned'),
      context: z.string().describe('Context about when this pattern applies'),
      confidence: z.number().min(0).max(1).optional().describe('Confidence score (0-1)'),
    },
    async ({ repo, pattern_type, pattern, context: patternContext, confidence }) => {
      const id = await db.storeLearning(repo, pattern_type, pattern, patternContext, confidence ?? 0.5);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: true, id, message: `Stored ${pattern_type} pattern for ${repo}` }),
          },
        ],
      };
    }
  );

  // Tool: Get learned patterns for a repository
  server.tool(
    'get_learnings',
    {
      repo: z.string().describe('Repository identifier (owner/name)'),
      pattern_type: z.enum(['code_quality', 'test_coverage', 'architecture', 'security']).optional().describe('Filter by pattern type'),
    },
    async ({ repo, pattern_type }) => {
      const learnings = await db.getLearnings(repo, pattern_type);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              repo,
              count: learnings.length,
              learnings: learnings.map((l) => ({
                id: l.id,
                type: l.pattern_type,
                pattern: l.pattern,
                context: l.context,
                confidence: l.confidence,
              })),
            }),
          },
        ],
      };
    }
  );

  // Tool: Update confidence for a learning
  server.tool(
    'update_confidence',
    {
      learning_id: z.number().describe('ID of the learning to update'),
      confidence: z.number().min(0).max(1).describe('New confidence score (0-1)'),
    },
    async ({ learning_id, confidence }) => {
      await db.updateLearningConfidence(learning_id, confidence);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: `Updated confidence to ${confidence}` }),
          },
        ],
      };
    }
  );

  // Tool: Log a completed review
  server.tool(
    'log_review',
    {
      repo: z.string().describe('Repository identifier (owner/name)'),
      pr_number: z.number().describe('Pull request number'),
      pr_title: z.string().describe('Pull request title'),
      author: z.string().describe('PR author username'),
      findings_count: z.number().describe('Number of findings'),
      escalated: z.boolean().describe('Whether the PR was escalated for human review'),
      summary: z.string().describe('Review summary'),
    },
    async ({ repo, pr_number, pr_title, author, findings_count, escalated, summary }) => {
      const id = await db.logReview(repo, pr_number, pr_title, author, findings_count, escalated, summary);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: true, id, message: `Logged review for PR #${pr_number}` }),
          },
        ],
      };
    }
  );

  // Tool: Get review history
  server.tool(
    'get_history',
    {
      repo: z.string().describe('Repository identifier (owner/name)'),
      limit: z.number().optional().describe('Max number of reviews to return'),
    },
    async ({ repo, limit }) => {
      const reviews = await db.getReviewHistory(repo, limit ?? 20);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              repo,
              count: reviews.length,
              reviews: reviews.map((r) => ({
                pr_number: r.pr_number,
                pr_title: r.pr_title,
                author: r.author,
                findings: r.findings_count,
                escalated: r.escalated,
                date: r.reviewed_at,
              })),
            }),
          },
        ],
      };
    }
  );

  // Tool: Get author statistics
  server.tool(
    'get_author_stats',
    {
      repo: z.string().describe('Repository identifier (owner/name)'),
      author: z.string().describe('Author username'),
    },
    async ({ repo, author }) => {
      const stats = await db.getAuthorStats(repo, author);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              repo,
              author,
              total_prs: stats.totalPRs,
              escalated_prs: stats.escalatedPRs,
              avg_findings: stats.avgFindings?.toFixed(1) ?? 0,
            }),
          },
        ],
      };
    }
  );

  // Tool: Set repository context
  server.tool(
    'set_context',
    {
      repo: z.string().describe('Repository identifier (owner/name)'),
      key: z.string().describe('Context key (e.g., "architecture", "testing_strategy")'),
      value: z.string().describe('Context value'),
    },
    async ({ repo, key, value }) => {
      await db.setContext(repo, key, value);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: true, message: `Set ${key} context for ${repo}` }),
          },
        ],
      };
    }
  );

  // Tool: Get full repository context (for agent prompts)
  server.tool(
    'get_full_context',
    {
      repo: z.string().describe('Repository identifier (owner/name)'),
    },
    async ({ repo }) => {
      const fullContext = await db.getFullContext(repo);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              repo,
              learnings_count: fullContext.learnings.length,
              recent_reviews_count: fullContext.recentReviews.length,
              context_keys: fullContext.context.map((c) => c.key),
              learnings: fullContext.learnings.slice(0, 10),
              recent_reviews: fullContext.recentReviews.slice(0, 5),
              context: Object.fromEntries(fullContext.context.map((c) => [c.key, c.value])),
            }),
          },
        ],
      };
    }
  );

  return { server, context };
}
