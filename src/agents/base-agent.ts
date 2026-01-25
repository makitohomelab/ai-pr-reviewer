/**
 * Base Agent
 *
 * Abstract base class for specialized PR review agents.
 * Each agent focuses on a specific aspect of code review
 * (security, breaking changes, tests, performance).
 */

import type { ModelProvider, ModelCapability } from '../lib/model-provider.js';
import type { FileChange } from '../lib/github.js';
import type { BaseContext, PRDelta } from '../context/index.js';
import {
  createTokenBudget,
  estimateTokens,
  truncateToTokenBudget,
  truncatePatch,
  type TokenBudget,
} from '../context/index.js';

/**
 * Finding from an agent's analysis.
 */
export interface AgentFinding {
  /** Agent that generated this finding */
  agent: string;
  /** Priority level */
  priority: 'critical' | 'high' | 'medium';
  /** Category of the finding */
  category: string;
  /** File where the issue was found */
  file?: string;
  /** Line number in the file */
  line?: number;
  /** Description of the finding */
  message: string;
  /** Suggested fix or action */
  suggestion?: string;
}

/**
 * Configuration for an agent.
 */
export interface AgentConfig {
  /** Agent name for identification */
  name: string;
  /** Model capability for routing */
  capability: ModelCapability;
  /** Token budget for this agent */
  tokenBudget: number;
  /** Execution priority (lower = runs first) */
  priority: number;
}

/**
 * Input to an agent's run method.
 */
export interface AgentInput {
  /** Changed files from the PR */
  files: FileChange[];
  /** PR title */
  prTitle: string;
  /** PR body/description */
  prBody: string;
  /** Base context from .claude/context/ */
  baseContext: BaseContext;
  /** PR-specific delta */
  prDelta: PRDelta;
  /** Findings from previous agents in the pipeline */
  previousFindings: AgentFinding[];
}

/**
 * Output from an agent's analysis.
 */
export interface AgentOutput {
  /** Agent name */
  agent: string;
  /** Findings from this agent */
  findings: AgentFinding[];
  /** Summary of what was analyzed */
  summary: string;
  /** Confidence in the analysis (0-1) */
  confidence: number;
  /** Benchmark data */
  benchmark?: {
    llmLatencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
    model: string;
  };
}

/**
 * Abstract base class for specialized agents.
 */
export abstract class BaseAgent {
  protected readonly config: AgentConfig;
  protected readonly provider: ModelProvider;
  protected readonly budget: TokenBudget;

  constructor(provider: ModelProvider, config: AgentConfig) {
    this.provider = provider;
    this.config = config;
    this.budget = createTokenBudget({ total: config.tokenBudget });
  }

  /** Get agent name */
  get name(): string {
    return this.config.name;
  }

  /** Get agent priority */
  get priority(): number {
    return this.config.priority;
  }

  /**
   * Build system prompt for this agent.
   * Subclasses must implement this.
   */
  protected abstract buildSystemPrompt(
    context: BaseContext,
    delta: PRDelta
  ): string;

  /**
   * Get the JSON schema for structured output.
   * Subclasses must implement this.
   */
  protected abstract getResponseSchema(): Record<string, unknown>;

  /**
   * Parse the LLM response into findings.
   * Subclasses must implement this.
   */
  protected abstract parseResponse(
    response: string,
    input: AgentInput
  ): { findings: AgentFinding[]; summary: string; confidence: number };

  /**
   * Build the user prompt with PR content.
   */
  protected buildUserPrompt(input: AgentInput): string {
    const sections: string[] = [];

    // PR header
    sections.push(`## PR: ${input.prTitle}`);
    if (input.prBody) {
      sections.push(input.prBody);
    }

    // Previous findings summary (if any)
    if (input.previousFindings.length > 0) {
      const findingSummary = input.previousFindings
        .slice(0, 5)
        .map((f) => `- [${f.agent}/${f.priority}] ${f.message}`)
        .join('\n');
      sections.push(`## Previous Findings\n${findingSummary}`);
    }

    // File changes
    sections.push('## Changed Files');

    for (const file of input.files) {
      const status =
        file.status === 'added'
          ? '(new)'
          : file.status === 'removed'
            ? '(deleted)'
            : '';
      const header = `### ${file.filename} ${status}`;
      const stats = `+${file.additions} -${file.deletions}`;

      let patch = file.patch || '(binary or too large)';
      // Truncate large patches
      if (estimateTokens(patch) > 2000) {
        patch = truncatePatch(patch, 2000);
      }

      sections.push(`${header}\n${stats}\n\n\`\`\`diff\n${patch}\n\`\`\``);
    }

    return sections.join('\n\n');
  }

  /**
   * Run the agent analysis.
   */
  async run(input: AgentInput): Promise<AgentOutput> {
    const startTime = performance.now();

    // Build prompts
    const systemPrompt = this.buildSystemPrompt(
      input.baseContext,
      input.prDelta
    );
    let userPrompt = this.buildUserPrompt(input);

    // Apply token budget
    const systemTokens = estimateTokens(systemPrompt);
    const availableForUser =
      this.budget.total - systemTokens - this.budget.response;

    if (estimateTokens(userPrompt) > availableForUser) {
      userPrompt = truncateToTokenBudget(userPrompt, availableForUser);
    }

    // Call LLM
    const response = await this.provider.chat(
      {
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens: this.budget.response,
        jsonSchema: this.getResponseSchema(),
        temperature: 0,
      },
      this.config.capability
    );

    const llmLatencyMs = Math.round(performance.now() - startTime);

    // Parse response
    const { findings, summary, confidence } = this.parseResponse(
      response.content,
      input
    );

    return {
      agent: this.config.name,
      findings,
      summary,
      confidence,
      benchmark: {
        llmLatencyMs,
        inputTokens: response.usage?.inputTokens,
        outputTokens: response.usage?.outputTokens,
        model: this.provider.getModelName(this.config.capability),
      },
    };
  }
}

/**
 * Common response schema for agents.
 */
export const BASE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          priority: { type: 'string', enum: ['critical', 'high', 'medium'] },
          category: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          message: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['priority', 'category', 'message'],
      },
    },
    summary: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['findings', 'summary', 'confidence'],
};

/**
 * Helper to parse common response format.
 */
export function parseCommonResponse(
  response: string,
  agentName: string
): { findings: AgentFinding[]; summary: string; confidence: number } {
  let parsed: {
    findings?: Array<{
      priority?: string;
      category?: string;
      file?: string;
      line?: number;
      message?: string;
      suggestion?: string;
    }>;
    summary?: string;
    confidence?: number;
  };

  try {
    parsed = JSON.parse(response);
  } catch {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      return {
        findings: [],
        summary: 'Failed to parse response',
        confidence: 0,
      };
    }
  }

  const findings: AgentFinding[] = [];

  if (Array.isArray(parsed.findings)) {
    for (const f of parsed.findings.slice(0, 5)) {
      const priority = ['critical', 'high', 'medium'].includes(f.priority || '')
        ? (f.priority as 'critical' | 'high' | 'medium')
        : 'medium';

      findings.push({
        agent: agentName,
        priority,
        category: f.category || 'general',
        file: f.file,
        line: typeof f.line === 'number' ? f.line : undefined,
        message: String(f.message || 'No details'),
        suggestion: f.suggestion,
      });
    }
  }

  return {
    findings,
    summary: String(parsed.summary || 'Analysis complete'),
    confidence:
      typeof parsed.confidence === 'number'
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0.8,
  };
}
