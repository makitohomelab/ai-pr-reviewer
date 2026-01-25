/**
 * Test Coverage Agent
 *
 * Specialized agent for analyzing test coverage:
 * - Untested code paths
 * - Missing edge case tests
 * - Test quality issues
 * - Mocking problems
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

const TEST_COVERAGE_CONFIG: AgentConfig = {
  name: 'test-coverage',
  capability: 'code-review',
  tokenBudget: 16384,
  priority: 3, // Runs after breaking
};

/**
 * Test coverage analysis agent.
 */
export class TestCoverageAgent extends BaseAgent {
  constructor(provider: ModelProvider) {
    super(provider, TEST_COVERAGE_CONFIG);
  }

  protected buildSystemPrompt(context: BaseContext, delta: PRDelta): string {
    const sections: string[] = [];

    // Base test coverage instructions
    sections.push(`You are a code reviewer focused on test coverage. Analyze the diff for testing gaps.

FOCUS AREAS:
1. **Untested Paths**: New code without corresponding tests
2. **Edge Cases**: Missing tests for error conditions, boundaries, null/undefined
3. **Test Quality**: Tests that don't actually verify behavior, over-mocking
4. **Integration Gaps**: Missing integration tests for connected components
5. **Regression Risk**: Changes to tested code without updating tests

SEVERITY GUIDE:
- critical: Security-sensitive code without tests
- high: Core business logic without tests
- medium: Helper functions or edge cases without tests

RULES:
- If new code is added, check for corresponding test files
- Look for error handling paths that aren't tested
- Check if tests actually assert meaningful behavior
- Consider if mocks are hiding real bugs
- Max 5 findings, most severe first

HINT: Test files typically have .test.ts, .spec.ts, or are in __tests__ directories.`);

    // Add repo-specific context if available
    if (context.qwenPrompts.testCoveragePreamble) {
      sections.push(`\nREPO-SPECIFIC TESTING PATTERNS:\n${context.qwenPrompts.testCoveragePreamble}`);
    }

    // Add file categories to help identify test files
    const testCategory = delta.fileCategories.find((c) => c.name === 'Tests');
    const coreCategory = delta.fileCategories.find((c) => c.name === 'Core Logic');

    if (coreCategory && !testCategory) {
      sections.push(`\n⚠️ ALERT: Core logic changes detected but no test file changes.`);
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
                enum: ['untested', 'edge-case', 'test-quality', 'integration', 'regression', 'other'],
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
 * Create a test coverage agent instance.
 */
export function createTestCoverageAgent(provider: ModelProvider): TestCoverageAgent {
  return new TestCoverageAgent(provider);
}
