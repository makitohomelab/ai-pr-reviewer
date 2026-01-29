/**
 * QwenClient — lightweight wrapper around OllamaProvider
 *
 * Simplified methods for common use cases: free-form questions,
 * structured JSON queries, and diff review.
 */

import { OllamaProvider } from './providers/ollama-provider.js';
import {
  BASE_RESPONSE_SCHEMA,
  parseCommonResponse,
  type AgentFinding,
} from '../agents/base-agent.js';

export interface QwenClientConfig {
  baseUrl?: string;
  model?: string;
}

export class QwenClient {
  private provider: OllamaProvider;

  constructor(config?: QwenClientConfig) {
    this.provider = new OllamaProvider({
      baseUrl: config?.baseUrl ?? 'http://100.108.144.37:11434',
      model: config?.model ?? 'qwen2.5-coder:32b',
    });
  }

  /** Simple text question → string answer */
  async ask(
    question: string,
    options?: { system?: string },
  ): Promise<string> {
    const result = await this.provider.chat(
      {
        messages: [{ role: 'user', content: question }],
        system: options?.system,
        temperature: 0,
      },
      'fast',
    );
    return result.content;
  }

  /** Structured query → typed JSON result */
  async query<T>(
    prompt: string,
    schema: Record<string, unknown>,
    options?: { system?: string },
  ): Promise<T> {
    const result = await this.provider.chat(
      {
        messages: [{ role: 'user', content: prompt }],
        system: options?.system,
        jsonSchema: schema,
        temperature: 0,
      },
      'fast',
    );

    try {
      return JSON.parse(result.content) as T;
    } catch {
      throw new Error(
        `Failed to parse structured response as JSON: ${result.content.slice(0, 200)}`,
      );
    }
  }

  /** Review a diff → AgentFinding[] using BASE_RESPONSE_SCHEMA */
  async reviewDiff(
    diff: string,
    options?: { title?: string },
  ): Promise<AgentFinding[]> {
    const title = options?.title ?? 'Diff review';
    const prompt = [
      `## ${title}`,
      '',
      'Review the following diff for bugs, security issues, and code quality problems.',
      'Return findings in the required JSON schema.',
      '',
      '```diff',
      diff,
      '```',
    ].join('\n');

    const result = await this.provider.chat(
      {
        messages: [{ role: 'user', content: prompt }],
        system:
          'You are a code reviewer. Analyze diffs and report findings as structured JSON.',
        jsonSchema: BASE_RESPONSE_SCHEMA,
        temperature: 0,
      },
      'code-review',
    );

    const { findings } = parseCommonResponse(result.content, 'qwen-client');
    return findings;
  }

  /** Check if Ollama is reachable */
  async isAvailable(): Promise<boolean> {
    return this.provider.healthCheck();
  }
}
