/**
 * Review Response Module
 *
 * Handles parsing Qwen's review findings and formatting Claude's responses.
 * Used by the /respond-to-review skill.
 */

import type { ReactionType } from './github.js';

/**
 * A parsed finding from Qwen's review comment
 */
export interface ParsedFinding {
  /** Original index in the review */
  index: number;
  /** Agent that generated the finding */
  agent: string;
  /** Category of the finding */
  category: string;
  /** Priority level */
  priority: 'critical' | 'high' | 'medium';
  /** The finding message */
  message: string;
  /** File path if specified */
  file?: string;
  /** Line number if specified */
  line?: number;
  /** Suggested fix if provided */
  suggestion?: string;
  /** Raw text of the finding */
  rawText: string;
}

/**
 * Response action for a finding
 */
export type ResponseAction = 'ignore' | 'accept' | 'todo' | 'comment';

/**
 * Extended response action including merge
 */
export type ExtendedResponseAction = ResponseAction | 'merge';

/**
 * Emoji reactions for each action type
 */
export const ACTION_REACTIONS: Record<ExtendedResponseAction, ReactionType> = {
  ignore: 'eyes',      // 👀 Acknowledged but not acting
  accept: '+1',        // 👍 Will fix
  todo: 'rocket',      // 🚀 Added to backlog
  comment: 'confused', // 😕 Need clarification / discussing
  merge: 'heart',      // ❤️ Approved & merged
};

/**
 * Options for merging a PR
 */
export interface MergeOptions {
  method: 'merge' | 'squash' | 'rebase';
  deleteBranch?: boolean;
}

/**
 * A response session tracking the full review response workflow
 */
export interface ResponseSession {
  prNumber: number;
  reviewCommentId: number;
  findings: ParsedFinding[];
  responses: FindingResponse[];
}

/**
 * Response to a single finding
 */
export interface FindingResponse {
  /** The original finding */
  finding: ParsedFinding;
  /** Action taken */
  action: ResponseAction;
  /** Response comment (required for 'comment' action, optional for others) */
  comment?: string;
  /** Commit SHA if a fix was made */
  commitSha?: string;
}

/**
 * Parse the AI Review comment body to extract findings
 */
export function parseReviewFindings(reviewBody: string): ParsedFinding[] {
  const findings: ParsedFinding[] = [];

  // Match finding lines like:
  // 🔴 **[security/injection]** Message in `file:line`
  // 🟠 **[breaking/api-change]** Message in `file`
  // 🟡 **[tests/coverage]** Message
  // Note: `u` flag for Unicode emoji, `m` for multiline, non-greedy message
  const findingPattern =
    /([🔴🟠🟡])\s*\*\*\[([^/]+)\/([^\]]+)\]\*\*\s*(.+?)(?:\s+in\s+`([^`]+)`)?(?=\s*$|\s*\n|$)/gum;

  let match;
  let index = 0;

  while ((match = findingPattern.exec(reviewBody)) !== null) {
    const [rawText, icon, agent, category, message, location] = match;

    // Determine priority from icon
    const priority: ParsedFinding['priority'] =
      icon === '🔴' ? 'critical' : icon === '🟠' ? 'high' : 'medium';

    // Parse file:line from location
    let file: string | undefined;
    let line: number | undefined;

    if (location) {
      const fileLine = location.split(':');
      file = fileLine[0];
      if (fileLine[1]) {
        const lineNum = parseInt(fileLine[1], 10);
        if (!isNaN(lineNum)) {
          line = lineNum;
        }
      }
    }

    // Look for suggestion on the next line
    let suggestion: string | undefined;
    const suggestionMatch = reviewBody
      .slice(match.index + rawText.length, match.index + rawText.length + 200)
      .match(/💡\s*\*?Suggestion:\*?\s*([^\n]+)/);
    if (suggestionMatch) {
      suggestion = suggestionMatch[1].trim();
    }

    findings.push({
      index,
      agent: agent.trim(),
      category: category.trim(),
      priority,
      message: message.trim(),
      file,
      line,
      suggestion,
      rawText,
    });

    index++;
  }

  return findings;
}

/**
 * Format a response summary comment
 */
export function formatResponseSummary(responses: FindingResponse[]): string {
  const sections: string[] = [];

  sections.push('## Response to AI Review\n');

  // Group by action
  const accepted = responses.filter((r) => r.action === 'accept');
  const todos = responses.filter((r) => r.action === 'todo');
  const ignored = responses.filter((r) => r.action === 'ignore');
  const commented = responses.filter((r) => r.action === 'comment');

  // Accepted findings
  if (accepted.length > 0) {
    sections.push('### Accepted (Will Fix)');
    for (const r of accepted) {
      const loc = r.finding.file
        ? ` in \`${r.finding.file}${r.finding.line ? `:${r.finding.line}` : ''}\``
        : '';
      let line = `- **[${r.finding.agent}/${r.finding.category}]** ${r.finding.message}${loc}`;
      if (r.commitSha) {
        line += ` - Fixed in ${r.commitSha.slice(0, 7)}`;
      }
      if (r.comment) {
        line += `\n  > ${r.comment}`;
      }
      sections.push(line);
    }
    sections.push('');
  }

  // TODOs
  if (todos.length > 0) {
    sections.push('### Deferred (TODO)');
    for (const r of todos) {
      let line = `- **[${r.finding.agent}/${r.finding.category}]** ${r.finding.message}`;
      if (r.comment) {
        line += `\n  > ${r.comment}`;
      }
      sections.push(line);
    }
    sections.push('');
  }

  // Commented (discussing)
  if (commented.length > 0) {
    sections.push('### Discussing');
    for (const r of commented) {
      let line = `- **[${r.finding.agent}/${r.finding.category}]** ${r.finding.message}`;
      if (r.comment) {
        line += `\n  > ${r.comment}`;
      }
      sections.push(line);
    }
    sections.push('');
  }

  // Ignored
  if (ignored.length > 0) {
    sections.push('### Acknowledged (No Action)');
    for (const r of ignored) {
      let line = `- **[${r.finding.agent}/${r.finding.category}]** ${r.finding.message}`;
      if (r.comment) {
        line += `\n  > ${r.comment}`;
      }
      sections.push(line);
    }
    sections.push('');
  }

  // Summary stats
  const total = responses.length;
  sections.push('---');
  sections.push(
    `**Summary:** ${accepted.length} accepted, ${todos.length} deferred, ${commented.length} discussing, ${ignored.length} acknowledged`
  );

  return sections.join('\n');
}

/**
 * Format an inline reply to a specific finding
 */
export function formatInlineReply(
  action: ResponseAction,
  comment?: string
): string {
  const actionLabels: Record<ResponseAction, string> = {
    accept: '**Action:** Will fix',
    todo: '**Action:** Added to TODO for future implementation',
    ignore: '**Action:** Acknowledged, no action needed',
    comment: '**Response:**',
  };

  const parts = [actionLabels[action]];

  if (comment) {
    parts.push(comment);
  }

  return parts.join('\n\n');
}

/**
 * Find the AI Review comment in a list of comments
 */
export function findAIReviewComment(
  comments: Array<{ id: number; body: string; user: string }>
): { id: number; body: string } | undefined {
  // Look for comments that start with "## AI Review" or contain the review format
  return comments.find(
    (c) =>
      c.body.includes('## AI Review') ||
      c.body.includes('### Issues Found') ||
      // Check for the finding pattern
      /[🔴🟠🟡]\s*\*\*\[/.test(c.body)
  );
}

/**
 * Suggested actions based on finding characteristics
 */
export function suggestAction(finding: ParsedFinding): {
  action: ResponseAction;
  reason: string;
} {
  // Critical security issues should generally be accepted
  if (finding.priority === 'critical' && finding.agent === 'security') {
    return { action: 'accept', reason: 'Critical security issue' };
  }

  // Test coverage findings might be deferred
  if (finding.agent === 'tests' || finding.category.includes('coverage')) {
    return { action: 'todo', reason: 'Test improvements can be deferred' };
  }

  // Performance suggestions are often optional
  if (finding.agent === 'performance' && finding.priority === 'medium') {
    return { action: 'ignore', reason: 'Optional performance optimization' };
  }

  // Default: needs review
  return { action: 'comment', reason: 'Needs human evaluation' };
}

/**
 * Check if a PR can be merged based on responses to findings
 *
 * Blocks merge if any critical finding has not been accepted (addressed).
 */
export function canMerge(responses: FindingResponse[]): { allowed: boolean; reason?: string } {
  const criticalUnaddressed = responses.filter(
    (r) => r.finding.priority === 'critical' && r.action !== 'accept'
  );

  if (criticalUnaddressed.length > 0) {
    const findings = criticalUnaddressed
      .map((r) => `[${r.finding.agent}/${r.finding.category}]`)
      .join(', ');
    return {
      allowed: false,
      reason: `Cannot merge: ${criticalUnaddressed.length} critical finding(s) not addressed: ${findings}`,
    };
  }

  return { allowed: true };
}
