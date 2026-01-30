/**
 * Pipeline Orchestrator
 *
 * Executes specialized agents in sequence or parallel.
 * - Sequential: Each agent sees findings from previous agents (better deduplication)
 * - Parallel: All agents run concurrently (faster, ~4x speedup)
 *
 * Includes pre-analysis phase that runs static code analysis and
 * infrastructure checks before agents execute.
 */

import type { FileChange } from '../lib/github.js';
import type { ModelProvider } from '../lib/model-provider.js';
import type { BaseContext, PRDelta } from '../context/index.js';
import type {
  BaseAgent,
  AgentFinding,
  AgentOutput,
} from '../agents/base-agent.js';
import {
  createSecurityAgent,
  createCodeReviewAgent,
  createTestCoverageAgent,
  CodeReviewAgent,
} from '../agents/index.js';
import {
  analyzeCodebase,
  analyzeInfrastructure,
  type StaticAnalysis,
  type InfraAnalysis,
  type InfraAnalysisConfig,
} from '../analysis/index.js';

/**
 * Execution mode for the pipeline.
 * - 'sequential': Agents run one after another, each seeing previous findings
 * - 'parallel': All agents run concurrently for faster execution
 */
export type ExecutionMode = 'sequential' | 'parallel';

/**
 * Configuration for pre-analysis phase.
 */
export interface PreAnalysisConfig {
  /** Enable static code analysis */
  enableStaticAnalysis?: boolean;
  /** Enable infrastructure analysis (requires MCP client) */
  enableInfraAnalysis?: boolean;
  /** Infrastructure analysis options */
  infraConfig?: Omit<InfraAnalysisConfig, 'skip'>;
  /** Repository root path for file analysis */
  repoPath?: string;
  /** File paths to analyze (if not provided, uses changed files) */
  filePaths?: string[];
}

/**
 * Configuration for the pipeline.
 */
export interface PipelineConfig {
  /** Custom agents to use (overrides defaults) */
  agents?: BaseAgent[];
  /** Execution mode: 'sequential' or 'parallel' (default: 'sequential') */
  executionMode?: ExecutionMode;
  /** Whether to stop on first critical finding (only applies to sequential) */
  stopOnCritical?: boolean;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Pre-analysis configuration */
  preAnalysis?: PreAnalysisConfig;
}

/**
 * Result from the pipeline execution.
 */
export interface PipelineResult {
  /** All findings from all agents */
  findings: AgentFinding[];
  /** Per-agent outputs */
  agentOutputs: AgentOutput[];
  /** Overall summary */
  summary: string;
  /** Average confidence across agents */
  confidence: number;
  /** Total execution time in ms */
  totalLatencyMs: number;
  /** Whether any critical findings were found */
  hasCritical: boolean;
  /** Execution mode used */
  executionMode: ExecutionMode;
  /** Static analysis results (if enabled) */
  staticAnalysis?: StaticAnalysis;
  /** Infrastructure analysis results (if enabled) */
  infraAnalysis?: InfraAnalysis;
}

/**
 * Default agents in execution order.
 */
function createDefaultAgents(provider: ModelProvider): BaseAgent[] {
  return [
    createSecurityAgent(provider),
    createCodeReviewAgent(provider),
    createTestCoverageAgent(provider),
  ];
}

/**
 * Pipeline orchestrator for agent execution.
 */
export class PipelineOrchestrator {
  private readonly provider: ModelProvider;
  private readonly agents: BaseAgent[];
  private readonly config: Required<Omit<PipelineConfig, 'preAnalysis'>> & {
    preAnalysis?: PreAnalysisConfig;
  };

  constructor(provider: ModelProvider, config: PipelineConfig = {}) {
    this.provider = provider;
    this.agents = config.agents || createDefaultAgents(provider);
    this.config = {
      agents: this.agents,
      executionMode: config.executionMode ?? 'sequential',
      stopOnCritical: config.stopOnCritical ?? false,
      verbose: config.verbose ?? (process.env.DEBUG_AI_REVIEW === 'true'),
      preAnalysis: config.preAnalysis,
    };

    // Sort agents by priority (relevant for sequential mode)
    this.agents.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Run pre-analysis phase (static analysis + infrastructure checks).
   */
  private async runPreAnalysis(
    files: FileChange[]
  ): Promise<{ static?: StaticAnalysis; infra?: InfraAnalysis }> {
    const preConfig = this.config.preAnalysis;
    if (!preConfig) {
      return {};
    }

    const result: { static?: StaticAnalysis; infra?: InfraAnalysis } = {};

    // Run static analysis
    if (preConfig.enableStaticAnalysis && preConfig.repoPath) {
      if (this.config.verbose) {
        console.log('\n📊 Running static code analysis...');
      }

      try {
        const filePaths = preConfig.filePaths || files.map((f) => f.filename);
        result.static = await analyzeCodebase(preConfig.repoPath, filePaths);

        if (this.config.verbose) {
          console.log(`   Files analyzed: ${result.static.fileMetrics.totalFiles}`);
          console.log(`   Complexity hotspots: ${result.static.complexityHotspots.length}`);
          console.log(`   Unused exports: ${result.static.unusedExports.length}`);
        }
      } catch (error) {
        console.error('❌ Static analysis failed:', error);
      }
    }

    // Run infrastructure analysis
    if (preConfig.enableInfraAnalysis && preConfig.infraConfig?.mcpClient) {
      if (this.config.verbose) {
        console.log('\n🔧 Running infrastructure analysis...');
      }

      try {
        result.infra = await analyzeInfrastructure({
          ...preConfig.infraConfig,
          skip: false,
        });

        if (this.config.verbose) {
          if (result.infra.skipped) {
            console.log(`   Skipped: ${result.infra.skipReason}`);
          } else {
            console.log(`   Containers: ${result.infra.containers.running}/${result.infra.containers.total}`);
            console.log(`   Config drift: ${result.infra.configDrift.verdict}`);
          }
        }
      } catch (error) {
        console.error('❌ Infrastructure analysis failed:', error);
      }
    }

    return result;
  }

  /**
   * Prepare CodeReviewAgent with analysis data.
   */
  private prepareCodeReviewAgent(
    staticAnalysis?: StaticAnalysis,
    infraAnalysis?: InfraAnalysis
  ): void {
    for (const agent of this.agents) {
      if (agent instanceof CodeReviewAgent) {
        agent.setAnalysisData(staticAnalysis, infraAnalysis);
      }
    }
  }

  /**
   * Run the pipeline in configured mode.
   */
  async run(
    files: FileChange[],
    prTitle: string,
    prBody: string,
    context: BaseContext,
    delta: PRDelta
  ): Promise<PipelineResult> {
    // Run pre-analysis phase
    const preAnalysis = await this.runPreAnalysis(files);

    // Prepare CodeReviewAgent with analysis data
    this.prepareCodeReviewAgent(preAnalysis.static, preAnalysis.infra);

    // Run agents
    let result: PipelineResult;
    if (this.config.executionMode === 'parallel') {
      result = await this.runParallel(files, prTitle, prBody, context, delta);
    } else {
      result = await this.runSequential(files, prTitle, prBody, context, delta);
    }

    // Attach pre-analysis results
    result.staticAnalysis = preAnalysis.static;
    result.infraAnalysis = preAnalysis.infra;

    return result;
  }

  /**
   * Run all agents in sequence, accumulating findings.
   */
  private async runSequential(
    files: FileChange[],
    prTitle: string,
    prBody: string,
    context: BaseContext,
    delta: PRDelta
  ): Promise<PipelineResult> {
    const startTime = performance.now();
    const findings: AgentFinding[] = [];
    const agentOutputs: AgentOutput[] = [];

    if (this.config.verbose) {
      console.log(`\n🔄 Pipeline starting (sequential) with ${this.agents.length} agents`);
      console.log(`   Order: ${this.agents.map((a) => a.name).join(' → ')}`);
    }

    for (const agent of this.agents) {
      if (this.config.verbose) {
        console.log(`\n🔍 Running ${agent.name} agent...`);
      }

      try {
        const output = await agent.run({
          files,
          prTitle,
          prBody,
          baseContext: context,
          prDelta: delta,
          previousFindings: [...findings], // Sequential: share previous findings
        });

        agentOutputs.push(output);
        findings.push(...output.findings);

        if (this.config.verbose) {
          console.log(`   Found ${output.findings.length} findings`);
          console.log(`   Confidence: ${(output.confidence * 100).toFixed(0)}%`);
          if (output.benchmark) {
            console.log(`   Latency: ${(output.benchmark.llmLatencyMs / 1000).toFixed(1)}s`);
          }
        }

        // Check for critical findings
        const criticalFindings = output.findings.filter(
          (f) => f.priority === 'critical'
        );
        if (criticalFindings.length > 0 && this.config.stopOnCritical) {
          console.log(`\n⚠️  Critical finding detected, stopping pipeline`);
          break;
        }
      } catch (error) {
        console.error(`❌ ${agent.name} agent failed:`, error);
        agentOutputs.push({
          agent: agent.name,
          findings: [],
          summary: `Agent failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          confidence: 0,
        });
      }
    }

    return this.buildResult(agentOutputs, performance.now() - startTime, 'sequential');
  }

  /**
   * Run all agents in parallel for faster execution.
   */
  private async runParallel(
    files: FileChange[],
    prTitle: string,
    prBody: string,
    context: BaseContext,
    delta: PRDelta
  ): Promise<PipelineResult> {
    const startTime = performance.now();

    if (this.config.verbose) {
      console.log(`\n🔄 Pipeline starting (parallel) with ${this.agents.length} agents`);
      console.log(`   Agents: ${this.agents.map((a) => a.name).join(', ')}`);
    }

    // Create promises for all agents
    const agentPromises = this.agents.map(async (agent) => {
      if (this.config.verbose) {
        console.log(`\n🔍 Starting ${agent.name} agent...`);
      }

      try {
        const output = await agent.run({
          files,
          prTitle,
          prBody,
          baseContext: context,
          prDelta: delta,
          previousFindings: [], // Parallel: no previous findings
        });

        if (this.config.verbose) {
          console.log(`✓ ${agent.name}: ${output.findings.length} findings, ${(output.confidence * 100).toFixed(0)}% confidence`);
        }

        return output;
      } catch (error) {
        console.error(`❌ ${agent.name} agent failed:`, error);
        return {
          agent: agent.name,
          findings: [],
          summary: `Agent failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          confidence: 0,
        } as AgentOutput;
      }
    });

    // Wait for all agents to complete
    const agentOutputs = await Promise.all(agentPromises);

    return this.buildResult(agentOutputs, performance.now() - startTime, 'parallel');
  }

  /**
   * Build the final result from agent outputs.
   */
  private buildResult(
    agentOutputs: AgentOutput[],
    elapsedMs: number,
    executionMode: ExecutionMode
  ): PipelineResult {
    const findings = agentOutputs.flatMap((o) => o.findings);
    const totalLatencyMs = Math.round(elapsedMs);

    // Calculate overall confidence
    const totalConfidence = agentOutputs.reduce((sum, o) => sum + o.confidence, 0);
    const confidence = totalConfidence / Math.max(agentOutputs.length, 1);

    // Check for critical findings
    const hasCritical = findings.some((f) => f.priority === 'critical');

    // Build summary
    const summary = this.buildSummary(agentOutputs, findings);

    if (this.config.verbose) {
      console.log(`\n✅ Pipeline complete (${executionMode})`);
      console.log(`   Total findings: ${findings.length}`);
      console.log(`   Critical: ${findings.filter((f) => f.priority === 'critical').length}`);
      console.log(`   High: ${findings.filter((f) => f.priority === 'high').length}`);
      console.log(`   Medium: ${findings.filter((f) => f.priority === 'medium').length}`);
      console.log(`   Total time: ${(totalLatencyMs / 1000).toFixed(1)}s`);
    }

    return {
      findings,
      agentOutputs,
      summary,
      confidence,
      totalLatencyMs,
      hasCritical,
      executionMode,
    };
  }

  /**
   * Build overall summary from agent outputs.
   */
  private buildSummary(outputs: AgentOutput[], findings: AgentFinding[]): string {
    const agentSummaries = outputs
      .filter((o) => o.summary)
      .map((o) => `**${o.agent}**: ${o.summary}`)
      .join('\n');

    const critical = findings.filter((f) => f.priority === 'critical').length;
    const high = findings.filter((f) => f.priority === 'high').length;
    const medium = findings.filter((f) => f.priority === 'medium').length;

    let overview = '';
    if (critical > 0) {
      overview = `Found ${critical} critical, ${high} high, and ${medium} medium priority issues.`;
    } else if (high > 0) {
      overview = `Found ${high} high and ${medium} medium priority issues. No critical issues detected.`;
    } else if (medium > 0) {
      overview = `Found ${medium} medium priority issues. No critical or high priority issues.`;
    } else {
      overview = 'No issues detected across all review areas.';
    }

    return `${overview}\n\n${agentSummaries}`;
  }
}

/**
 * Create a pipeline orchestrator with default configuration.
 */
export function createPipeline(
  provider: ModelProvider,
  config?: PipelineConfig
): PipelineOrchestrator {
  return new PipelineOrchestrator(provider, config);
}
