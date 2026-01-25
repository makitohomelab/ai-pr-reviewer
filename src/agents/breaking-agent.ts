/**
 * Breaking Changes Agent
 *
 * Specialized agent for detecting breaking changes:
 * - API signature changes
 * - Removed exports
 * - Type changes
 * - Behavioral changes affecting callers
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

const BREAKING_CONFIG: AgentConfig = {
  name: 'breaking',
  capability: 'code-review',
  tokenBudget: 16384,
  priority: 2, // Runs after security
};

/**
 * Breaking changes detection agent.
 */
export class BreakingAgent extends BaseAgent {
  constructor(provider: ModelProvider) {
    super(provider, BREAKING_CONFIG);
  }

  protected buildSystemPrompt(context: BaseContext, delta: PRDelta): string {
    const sections: string[] = [];

    // Base breaking changes instructions
    sections.push(`You are a code reviewer focused on detecting breaking changes. Analyze the diff for changes that could break existing callers.

FOCUS AREAS:
1. **API Changes**: Function signature changes, parameter type changes, return type changes
2. **Removed Exports**: Deleted public functions, classes, constants, types
3. **Renamed Symbols**: Changed function/class/variable names that are exported
4. **Behavioral Changes**: Logic changes that alter expected behavior
5. **Config Changes**: Changed defaults, removed options, new required fields

SEVERITY GUIDE:
- critical: Major breaking change affecting all callers
- high: Breaking change requiring caller updates
- medium: Potential breaking change under specific conditions

RULES:
- Focus on PUBLIC interfaces (exports, APIs)
- Internal/private changes are NOT breaking unless they affect behavior
- Look for removed/renamed exports in .ts/.js files
- Check for changed function parameters or return types
- Max 5 findings, most severe first`);

    // Add repo-specific context if available
    if (context.qwenPrompts.breakingPreamble) {
      sections.push(`\nREPO-SPECIFIC PATTERNS:\n${context.qwenPrompts.breakingPreamble}`);
    }

    // Add architecture patterns
    const archPatterns = delta.changedPatterns.filter(
      (p) => p.type === 'architecture'
    );
    if (archPatterns.length > 0) {
      const patternLines = archPatterns
        .slice(0, 3)
        .map((p) => `- ${p.id}: ${p.description}`);
      sections.push(`\nARCHITECTURE PATTERNS:\n${patternLines.join('\n')}`);
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
                enum: ['api', 'export', 'rename', 'behavior', 'config', 'other'],
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
 * Create a breaking changes agent instance.
 */
export function createBreakingAgent(provider: ModelProvider): BreakingAgent {
  return new BreakingAgent(provider);
}
