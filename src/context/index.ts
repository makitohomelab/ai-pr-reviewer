/**
 * Context System
 *
 * Re-exports for the context loading and delta generation system.
 */

export {
  loadBaseContext,
  getPatternsByType,
  getHighWeightPatterns,
  type BaseContext,
  type Pattern,
  type QwenPromptFragments,
} from './context-loader.js';

export {
  generatePRDelta,
  formatDeltaAsContext,
  type PRDelta,
  type FileCategory,
  type RiskFactor,
} from './delta-generator.js';

export {
  createTokenBudget,
  estimateTokens,
  truncateToTokenBudget,
  truncatePatch,
  calculateAvailableDiffBudget,
  formatBudgetUsage,
  DEFAULT_TOKEN_BUDGET,
  type TokenBudget,
} from './token-budget.js';
