/**
 * Pipeline System
 *
 * Re-exports for the agent pipeline system.
 */

export {
  PipelineOrchestrator,
  createPipeline,
  type ExecutionMode,
  type PipelineConfig,
  type PipelineResult,
} from './pipeline-orchestrator.js';

export {
  aggregateResults,
  filterUngroundedFindings,
  formatAsMarkdown,
  formatAsCompactSummary,
  type AggregatedResult,
} from './result-aggregator.js';

export {
  syncToMCP,
  getMCPSyncConfig,
  formatSyncResult,
  type MCPSyncConfig,
  type MCPSyncResult,
} from './mcp-sync.js';
