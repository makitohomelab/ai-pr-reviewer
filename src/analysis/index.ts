/**
 * Analysis Module
 *
 * Pre-analysis tools that run before LLM agents to generate
 * compact summaries of codebase health and infrastructure status.
 */

export {
  analyzeCodebase,
  summarizeStaticAnalysis,
  type StaticAnalysis,
  type ComplexityHotspot,
  type UnusedExport,
  type DuplicateCandidate,
  type FileMetrics,
} from './static-analyzer.js';

export {
  analyzeInfrastructure,
  summarizeInfraAnalysis,
  type InfraAnalysis,
  type InfraAnalysisConfig,
  type ContainerStatus,
  type ConfigDrift,
  type PortExposure,
  type NetworkHealth,
  type ComposeService,
  type ExpectedPort,
  type MCPClient,
} from './infra-analyzer.js';
