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
  BreakingAgent,
  createBreakingAgent,
} from './breaking-agent.js';

export {
  TestCoverageAgent,
  createTestCoverageAgent,
} from './test-coverage-agent.js';

export {
  PerformanceAgent,
  createPerformanceAgent,
} from './performance-agent.js';

export {
  CodebaseQualityAgent,
  createCodebaseQualityAgent,
  type CodebaseQualityInput,
  type CodebaseQualityCategory,
} from './codebase-quality-agent.js';

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
