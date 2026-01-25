/**
 * Performance Agent
 *
 * Specialized agent for detecting performance issues:
 * - Resource leaks
 * - N+1 queries
 * - Memory issues
 * - Inefficient algorithms
 */

import type { ModelProvider } from '../lib/model-provider.js';
import type { BaseContext, PRDelta } from '../context/index.js';
import {
  BaseAgent,
  BASE_RESPONSE_SCHEMA,
  parseCommonResponse,
  type AgentConfig,
  type AgentInput,
  type AgentFinding,
} from './base-agent.js';

const PERFORMANCE_CONFIG: AgentConfig = {
  name: 'performance',
  capability: 'code-review',
  tokenBudget: 16384,
  priority: 4, // Runs last
};

/**
 * Performance analysis agent.
 */
export class PerformanceAgent extends BaseAgent {
  constructor(provider: ModelProvider) {
    super(provider, PERFORMANCE_CONFIG);
  }

  protected buildSystemPrompt(context: BaseContext, delta: PRDelta): string {
    const sections: string[] = [];

    // Base performance instructions
    sections.push(`You are a code reviewer focused on performance. Analyze the diff for performance issues.

FOCUS AREAS:
1. **Resource Leaks**: Unclosed connections, streams, file handles, event listeners
2. **N+1 Queries**: Database/API calls in loops, redundant fetches
3. **Memory Issues**: Large object allocations, unbounded arrays, memory leaks
4. **Algorithm Complexity**: O(n²) or worse in hot paths, unnecessary iterations
5. **Blocking Operations**: Sync I/O in async contexts, missing await, blocking main thread

SEVERITY GUIDE:
- critical: Resource leak causing system degradation, blocking in hot path
- high: N+1 queries, memory leaks in long-running processes
- medium: Suboptimal algorithms, minor inefficiencies

RULES:
- Focus on actual performance impact, not micro-optimizations
- Consider the execution context (hot path vs. one-time setup)
- Look for patterns like: loops with await, missing cleanup in finally
- Check for large data structures being copied or rebuilt unnecessarily
- Max 5 findings, most severe first`);

    // Add repo-specific context if available
    if (context.qwenPrompts.performancePreamble) {
      sections.push(`\nREPO-SPECIFIC PERFORMANCE PATTERNS:\n${context.qwenPrompts.performancePreamble}`);
    }

    // Check for high-risk categories
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
                enum: ['resource-leak', 'n+1', 'memory', 'algorithm', 'blocking', 'other'],
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
 * Create a performance agent instance.
 */
export function createPerformanceAgent(provider: ModelProvider): PerformanceAgent {
  return new PerformanceAgent(provider);
}
