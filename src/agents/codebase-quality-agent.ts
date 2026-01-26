/**
 * Codebase Quality Agent
 *
 * Performs whole-codebase analysis beyond the PR diff:
 * - Code complexity trends
 * - Duplication detection
 * - Dead code / unused exports
 * - Pattern adherence
 * - Infrastructure alignment
 *
 * This agent receives pre-computed analysis summaries from the
 * static-analyzer and infra-analyzer modules, keeping token usage
 * within budget while enabling holistic codebase assessment.
 */

import type { ModelProvider } from '../lib/model-provider.js';
import type { BaseContext, PRDelta } from '../context/index.js';
import type { StaticAnalysis } from '../analysis/static-analyzer.js';
import type { InfraAnalysis } from '../analysis/infra-analyzer.js';
import {
  summarizeStaticAnalysis,
  summarizeInfraAnalysis,
} from '../analysis/index.js';
import {
  BaseAgent,
  BASE_RESPONSE_SCHEMA,
  parseCommonResponse,
  type AgentConfig,
  type AgentInput,
  type AgentFinding,
} from './base-agent.js';

/**
 * Extended input for CodebaseQualityAgent.
 * Includes pre-computed analysis summaries.
 */
export interface CodebaseQualityInput extends AgentInput {
  /** Static analysis of the codebase */
  staticAnalysis?: StaticAnalysis;
  /** Infrastructure analysis */
  infraAnalysis?: InfraAnalysis;
}

const CODEBASE_QUALITY_CONFIG: AgentConfig = {
  name: 'codebase-quality',
  capability: 'code-review',
  tokenBudget: 16384,
  priority: 5, // Runs last, after other agents
};

/**
 * Categories for codebase quality findings.
 */
export type CodebaseQualityCategory =
  | 'complexity'
  | 'duplication'
  | 'dead-code'
  | 'pattern-drift'
  | 'infra-drift'
  | 'unused-export'
  | 'other';

/**
 * Codebase quality focused review agent.
 */
export class CodebaseQualityAgent extends BaseAgent {
  private staticAnalysis?: StaticAnalysis;
  private infraAnalysis?: InfraAnalysis;

  constructor(provider: ModelProvider) {
    super(provider, CODEBASE_QUALITY_CONFIG);
  }

  /**
   * Set the pre-computed analysis data.
   * Called by the pipeline before running the agent.
   */
  setAnalysisData(
    staticAnalysis?: StaticAnalysis,
    infraAnalysis?: InfraAnalysis
  ): void {
    this.staticAnalysis = staticAnalysis;
    this.infraAnalysis = infraAnalysis;
  }

  protected buildSystemPrompt(context: BaseContext, delta: PRDelta): string {
    const sections: string[] = [];

    // Base codebase quality instructions
    sections.push(`You are a codebase health analyst. Review the PR in context of the whole codebase.

FOCUS AREAS:
1. **Complexity**: Does this PR increase cyclomatic complexity? Add deeply nested code?
2. **Duplication**: Does this PR copy existing code that should be shared?
3. **Dead Code**: Does this PR add exports nothing will import? Leave unused code?
4. **Pattern Drift**: Does this PR follow established codebase patterns?
5. **Infrastructure**: Are there config/infrastructure alignment issues?

SEVERITY GUIDE:
- critical: Major architectural violation, significant tech debt introduced
- high: Notable complexity increase, clear duplication, pattern violation
- medium: Minor complexity concern, possible dead code, style inconsistency

RULES:
- Compare PR changes against the provided codebase metrics
- Flag if PR makes overall codebase health worse
- Suggest refactoring opportunities when appropriate
- Consider whether changes follow existing patterns
- Max 5 findings, most impactful first`);

    // Add repo-specific quality context if available
    if (context.qwenPrompts.codebaseQualityPreamble) {
      sections.push(
        `\nREPO-SPECIFIC QUALITY PATTERNS:\n${context.qwenPrompts.codebaseQualityPreamble}`
      );
    }

    // Add static analysis summary
    if (this.staticAnalysis) {
      sections.push(
        `\nCODEBASE METRICS:\n${summarizeStaticAnalysis(this.staticAnalysis)}`
      );
    }

    // Add infrastructure analysis summary
    if (this.infraAnalysis && !this.infraAnalysis.skipped) {
      sections.push(
        `\nINFRASTRUCTURE STATUS:\n${summarizeInfraAnalysis(this.infraAnalysis)}`
      );
    }

    // Add risk factors from delta
    const qualityRisks = delta.riskFactors.filter(
      (r) => r.type === 'complexity' || r.type === 'scope'
    );
    if (qualityRisks.length > 0) {
      const riskLines = qualityRisks.map((r) => `- ${r.description}`);
      sections.push(`\nIDENTIFIED RISK AREAS:\n${riskLines.join('\n')}`);
    }

    // Add relevant patterns
    const architecturePatterns = delta.changedPatterns.filter(
      (p) => p.type === 'architecture' || p.type === 'convention'
    );
    if (architecturePatterns.length > 0) {
      const patternLines = architecturePatterns
        .slice(0, 3)
        .map((p) => `- ${p.id}: ${p.description}`);
      sections.push(`\nESTABLISHED PATTERNS:\n${patternLines.join('\n')}`);
    }

    return sections.join('\n');
  }

  protected getResponseSchema(): Record<string, unknown> {
    return {
      ...BASE_RESPONSE_SCHEMA,
      properties: {
        ...BASE_RESPONSE_SCHEMA.properties,
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              priority: { type: 'string', enum: ['critical', 'high', 'medium'] },
              category: {
                type: 'string',
                enum: [
                  'complexity',
                  'duplication',
                  'dead-code',
                  'pattern-drift',
                  'infra-drift',
                  'unused-export',
                  'other',
                ],
              },
              file: { type: 'string' },
              line: { type: 'integer' },
              message: { type: 'string' },
              suggestion: { type: 'string' },
            },
            required: ['priority', 'category', 'message'],
          },
        },
      },
    };
  }

  protected parseResponse(
    response: string,
    _input: AgentInput
  ): { findings: AgentFinding[]; summary: string; confidence: number } {
    return parseCommonResponse(response, this.config.name);
  }
}

/**
 * Create a codebase quality agent instance.
 */
export function createCodebaseQualityAgent(
  provider: ModelProvider
): CodebaseQualityAgent {
  return new CodebaseQualityAgent(provider);
}
