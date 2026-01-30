/**
 * Agents
 *
 * Re-exports for all specialized PR review agents.
 */

export {
  BaseAgent,
  BASE_RESPONSE_SCHEMA,
  parseCommonResponse,
  type AgentConfig,
  type AgentInput,
  type AgentOutput,
  type AgentFinding,
} from './base-agent.js';

export {
  SecurityAgent,
  createSecurityAgent,
} from './security-agent.js';

export {
  CodeReviewAgent,
  createCodeReviewAgent,
} from './code-review-agent.js';

export {
  TestCoverageAgent,
  createTestCoverageAgent,
} from './test-coverage-agent.js';

// Re-export legacy test-quality agent for backward compatibility
export {
  runTestQualityAgent,
  formatFindingsAsMarkdown,
  calculateImportance,
  type AgentResult,
  type QualityFinding,
  type ReviewedArea,
  type PRImportance,
} from './test-quality.js';
