/**
 * Token Budget Management
 *
 * Manages token allocation across different prompt components
 * to ensure agents stay within context limits.
 */

/**
 * Token budget allocation for an agent.
 */
export interface TokenBudget {
  /** Total token budget for the agent */
  total: number;
  /** Budget for system prompt */
  systemPrompt: number;
  /** Budget for base context */
  context: number;
  /** Budget for previous findings from other agents */
  previousFindings: number;
  /** Budget for source context (imported files) */
  sourceContext: number;
  /** Budget for PR diff content */
  prDiff: number;
  /** Reserved for response generation */
  response: number;
}

/**
 * Default token budget (16K total, typical for Qwen 2.5 Coder context).
 */
export const DEFAULT_TOKEN_BUDGET: TokenBudget = {
  total: 32768,
  systemPrompt: 2000,
  context: 2000,
  previousFindings: 1000,
  sourceContext: 8000,
  prDiff: 12000,
  response: 4000,
};

/**
 * Create a token budget with custom values.
 */
export function createTokenBudget(
  overrides: Partial<TokenBudget> = {}
): TokenBudget {
  const budget = { ...DEFAULT_TOKEN_BUDGET, ...overrides };

  // Validate that allocations don't exceed total
  const allocated =
    budget.systemPrompt +
    budget.context +
    budget.previousFindings +
    budget.sourceContext +
    budget.prDiff +
    budget.response;

  if (allocated > budget.total) {
    console.warn(
      `⚠️  Token budget overflow: ${allocated} allocated > ${budget.total} total`
    );
  }

  return budget;
}

/**
 * Estimate token count for text.
 * Uses simple approximation: ~4 characters per token for English text/code.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // More conservative estimate for code which has more punctuation
  return Math.ceil(text.length / 3.5);
}

/**
 * Truncate text to fit within token budget.
 *
 * @param text - Text to truncate
 * @param maxTokens - Maximum tokens allowed
 * @param suffix - Suffix to append if truncated
 * @returns Truncated text with suffix if truncated
 */
export function truncateToTokenBudget(
  text: string,
  maxTokens: number,
  suffix: string = '\n... (truncated)'
): string {
  const currentTokens = estimateTokens(text);

  if (currentTokens <= maxTokens) {
    return text;
  }

  // Calculate target character count
  const targetChars = Math.floor(maxTokens * 3.5) - suffix.length;
  if (targetChars <= 0) {
    return suffix;
  }

  // Try to truncate at a line boundary
  let truncated = text.substring(0, targetChars);
  const lastNewline = truncated.lastIndexOf('\n');
  if (lastNewline > targetChars * 0.5) {
    truncated = truncated.substring(0, lastNewline);
  }

  return truncated + suffix;
}

/**
 * Truncate a patch (diff) intelligently.
 * Preserves the beginning and end, removes middle content.
 */
export function truncatePatch(
  patch: string,
  maxTokens: number
): string {
  const currentTokens = estimateTokens(patch);

  if (currentTokens <= maxTokens) {
    return patch;
  }

  const lines = patch.split('\n');
  const targetChars = Math.floor(maxTokens * 3.5);

  // Keep first 1/3 and last 1/3 of lines
  const keepLines = Math.floor(lines.length * 0.3);
  const head = lines.slice(0, keepLines);
  const tail = lines.slice(-keepLines);

  const truncationNotice = [
    '',
    `... (${lines.length - keepLines * 2} lines omitted) ...`,
    '',
  ];

  const result = [...head, ...truncationNotice, ...tail].join('\n');

  // If still too long, do simple truncation
  if (result.length > targetChars) {
    return truncateToTokenBudget(patch, maxTokens);
  }

  return result;
}

/**
 * Allocate remaining budget dynamically based on content sizes.
 *
 * @param budget - Base token budget
 * @param systemPromptTokens - Actual system prompt size
 * @param contextTokens - Actual context size
 * @param findingsTokens - Actual previous findings size
 * @returns Available tokens for PR diff
 */
export function calculateAvailableDiffBudget(
  budget: TokenBudget,
  systemPromptTokens: number,
  contextTokens: number,
  findingsTokens: number
): number {
  const used = systemPromptTokens + contextTokens + findingsTokens;
  const available = budget.total - used - budget.response;

  // Ensure minimum diff budget
  const minDiffBudget = 2000;
  return Math.max(available, minDiffBudget);
}

/**
 * Format budget usage report for debugging.
 */
export function formatBudgetUsage(
  budget: TokenBudget,
  actual: {
    systemPrompt: number;
    context: number;
    previousFindings: number;
    sourceContext: number;
    prDiff: number;
  }
): string {
  const lines = [
    'Token Budget Usage:',
    `  System Prompt: ${actual.systemPrompt}/${budget.systemPrompt}`,
    `  Context: ${actual.context}/${budget.context}`,
    `  Prev Findings: ${actual.previousFindings}/${budget.previousFindings}`,
    `  Source Context: ${actual.sourceContext}/${budget.sourceContext}`,
    `  PR Diff: ${actual.prDiff}/${budget.prDiff}`,
    `  Reserved: ${budget.response}`,
    `  Total: ${actual.systemPrompt + actual.context + actual.previousFindings + actual.sourceContext + actual.prDiff + budget.response}/${budget.total}`,
  ];
  return lines.join('\n');
}
