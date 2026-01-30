/**
 * Code Review Agent
 *
 * Consolidated agent covering:
 * - Breaking changes (API changes, removed exports, renames)
 * - Performance issues (N+1, blocking I/O, resource leaks)
 * - Code quality (complexity, duplication, dead code, pattern drift)
 *
 * Receives pre-computed analysis summaries from static-analyzer
 * and infra-analyzer modules for holistic codebase assessment.
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

const CODE_REVIEW_CONFIG: AgentConfig = {
  name: 'code-review',
  capability: 'code-review',
  tokenBudget: 16384,
  priority: 2, // Runs after security
};

/**
 * Consolidated code review agent covering breaking changes,
 * performance, and code quality.
 */
export class CodeReviewAgent extends BaseAgent {
  private staticAnalysis?: StaticAnalysis;
  private infraAnalysis?: InfraAnalysis;

  constructor(provider: ModelProvider) {
    super(provider, CODE_REVIEW_CONFIG);
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

    sections.push(`You are a code reviewer covering breaking changes, performance, and code quality. Analyze the diff across all three areas.
GROUNDING: You may ONLY reference files that appear in the diff below. If a file is not in the diff, do not mention it. If you cannot find issues in diff files, return empty findings.

CRITICAL: Only flag issues you can SEE in the diff code. Do not speculate about unseen code.

## Breaking Changes
1. **API Changes**: Function signature changes, parameter type changes, return type changes
2. **Removed Exports**: Deleted public functions, classes, constants, types
3. **Renamed Symbols**: Changed function/class/variable names that are exported
4. **Behavioral Changes**: Logic changes that alter expected behavior
5. **Config Changes**: Changed defaults, removed options, new required fields

## Performance
1. await inside loops (N+1 pattern)
2. readFileSync/execSync in async functions
3. Unclosed streams/connections (no .close() or finally block)
4. Nested loops over same dataset

## Code Quality
1. **Complexity**: Does this PR increase cyclomatic complexity? Add deeply nested code?
2. **Duplication**: Does this PR copy existing code that should be shared?
3. **Dead Code**: Does this PR add exports nothing will import? Leave unused code?
4. **Pattern Drift**: Does this PR follow established codebase patterns?

SEVERITY GUIDE:
- critical: Major breaking change affecting all callers, resource leak causing system degradation, major architectural violation
- high: Breaking change requiring caller updates, N+1 queries, notable complexity increase
- medium: Potential breaking change under specific conditions, minor inefficiencies, style inconsistency

RULES:
- Focus on PUBLIC interfaces for breaking changes
- Consider execution context for performance (hot path vs. one-time setup)
- Compare PR changes against provided codebase metrics for quality
- Return 0-4 findings. If the diff has no issues, return an EMPTY findings array. Zero findings is the correct answer for clean code.
- Every finding MUST cite a specific code snippet or metric. Do not say "ensure", "consider", "might", "could", or "should consider" — state the concrete problem with evidence.
- Ask yourself: "Would a senior engineer reject this PR for this issue?" If no, do not report it.
- Prefer 0 findings over low-confidence findings. Quality over quantity.
- Do NOT report the same concern for multiple files. Report it ONCE with a representative example.`);

    // Add repo-specific context
    if (context.agentPrompts.codeReviewPreamble) {
      sections.push(`\nREPO-SPECIFIC PATTERNS:\n${context.agentPrompts.codeReviewPreamble}`);
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

    // Add architecture patterns
    const archPatterns = delta.changedPatterns.filter(
      (p) => p.type === 'architecture' || p.type === 'convention'
    );
    if (archPatterns.length > 0) {
      const patternLines = archPatterns
        .slice(0, 3)
        .map((p) => `- ${p.id}: ${p.description}`);
      sections.push(`\nESTABLISHED PATTERNS:\n${patternLines.join('\n')}`);
    }

    // Add risk factors from delta
    const risks = delta.riskFactors.filter(
      (r) => r.type === 'complexity' || r.type === 'scope'
    );
    if (risks.length > 0) {
      const riskLines = risks.map((r) => `- ${r.description}`);
      sections.push(`\nIDENTIFIED RISK AREAS:\n${riskLines.join('\n')}`);
    }

    // Add high-risk file categories
    const highRiskCategories = delta.fileCategories.filter(
      (c) => c.riskLevel === 'high'
    );
    if (highRiskCategories.length > 0) {
      sections.push(`\nHIGH-IMPACT AREAS:\n${highRiskCategories.map((c) => `- ${c.name}`).join('\n')}`);
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
                  'api',
                  'export',
                  'rename',
                  'behavior',
                  'config',
                  'resource-leak',
                  'n+1',
                  'memory',
                  'algorithm',
                  'blocking',
                  'complexity',
                  'duplication',
                  'dead-code',
                  'pattern-drift',
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
 * Create a code review agent instance.
 */
export function createCodeReviewAgent(provider: ModelProvider): CodeReviewAgent {
  return new CodeReviewAgent(provider);
}
