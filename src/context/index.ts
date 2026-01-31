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
  type AgentPromptFragments,
} from './context-loader.js';

export {
  generatePRDelta,
  formatDeltaAsContext,
  type PRDelta,
  type FileCategory,
  type RiskFactor,
} from './delta-generator.js';

export {
  extractImports,
  isLocalImport,
  resolveImportPath,
  getCandidatePaths,
  resolveAllImports,
} from './import-resolver.js';

export {
  buildSmartContext,
  formatSmartContext,
  type SmartContext,
  type SmartContextOptions,
} from './smart-context.js';

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
