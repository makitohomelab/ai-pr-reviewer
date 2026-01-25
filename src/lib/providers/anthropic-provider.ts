/**
 * Anthropic Model Provider
 *
 * Implements the ModelProvider interface for Anthropic's Claude models.
 * Wraps the @anthropic-ai/sdk for consistent interface.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  ModelProvider,
  ChatCompletionParams,
  ChatCompletionResult,
  ModelTier,
} from '../model-provider.js';

interface AnthropicConfig {
  apiKey?: string;
  fastModel?: string;
  smartModel?: string;
}

export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic';
  readonly defaultModel: string;
  private readonly client: Anthropic;
  private readonly fastModel: string;
  private readonly smartModel: string;

  constructor(config?: AnthropicConfig) {
    const apiKey = config?.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for Anthropic provider');
    }

    this.client = new Anthropic({ apiKey });
    this.fastModel = config?.fastModel || process.env.ANTHROPIC_FAST_MODEL || 'claude-3-5-haiku-20241022';
    this.smartModel = config?.smartModel || process.env.ANTHROPIC_SMART_MODEL || 'claude-sonnet-4-20250514';
    this.defaultModel = this.fastModel;
  }

  async chat(params: ChatCompletionParams, tier: ModelTier = 'fast'): Promise<ChatCompletionResult> {
    const model = tier === 'smart' ? this.smartModel : this.fastModel;

    const messages: Anthropic.MessageParam[] = params.messages.map((msg) => ({
      role: msg.role === 'system' ? 'user' : msg.role,
      content: msg.content,
    }));

    const response = await this.client.messages.create({
      model,
      max_tokens: params.maxTokens || 4096,
      system: params.system,
      messages,
    });

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Anthropic');
    }

    return {
      content: textContent.text,
      finishReason: response.stop_reason === 'end_turn' ? 'stop' : 'length',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Send a minimal request to verify API key works
      await this.client.messages.create({
        model: this.fastModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      return true;
    } catch {
      return false;
    }
  }

  getModelName(tier: ModelTier): string {
    return tier === 'smart' ? this.smartModel : this.fastModel;
  }
}
