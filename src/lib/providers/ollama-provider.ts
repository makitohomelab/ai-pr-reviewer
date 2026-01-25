/**
 * Ollama Model Provider
 *
 * Implements the ModelProvider interface for local Ollama instances.
 * Uses the OpenAI-compatible API that Ollama exposes on /v1 endpoints.
 */

import type {
  ModelProvider,
  ChatCompletionParams,
  ChatCompletionResult,
  ModelTier,
} from '../model-provider.js';

interface OllamaConfig {
  baseUrl: string;
  model?: string; // backward compat, sets both fast and smart
  fastModel?: string;
  smartModel?: string;
}

interface OpenAIChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
}

interface OpenAIChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

export class OllamaProvider implements ModelProvider {
  readonly name = 'ollama';
  readonly defaultModel: string;
  private readonly baseUrl: string;
  private readonly fastModel: string;
  private readonly smartModel: string;

  constructor(config?: Partial<OllamaConfig>) {
    this.baseUrl = config?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';

    // Support single model (backward compat) or separate fast/smart models
    const defaultModel = config?.model || process.env.OLLAMA_MODEL || 'llama3.2:3b';
    this.fastModel = config?.fastModel || process.env.OLLAMA_FAST_MODEL || defaultModel;
    this.smartModel = config?.smartModel || process.env.OLLAMA_SMART_MODEL || defaultModel;
    this.defaultModel = this.fastModel;
  }

  async chat(params: ChatCompletionParams, tier: ModelTier = 'fast'): Promise<ChatCompletionResult> {
    const model = tier === 'smart' ? this.smartModel : this.fastModel;
    const messages: OpenAIChatMessage[] = [];

    // Add system message if provided
    if (params.system) {
      messages.push({ role: 'system', content: params.system });
    }

    // Add conversation messages
    for (const msg of params.messages) {
      messages.push({ role: msg.role, content: msg.content });
    }

    const request: OpenAIChatRequest = {
      model,
      messages,
      max_tokens: params.maxTokens,
    };

    // Use generous timeout for larger models (5 minutes)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as OpenAIChatResponse;

    if (!data.choices || data.choices.length === 0) {
      throw new Error('No response from Ollama');
    }

    const choice = data.choices[0];

    return {
      content: choice.message.content,
      finishReason: choice.finish_reason === 'stop' ? 'stop' : 'length',
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
          }
        : undefined,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Check the models endpoint to verify Ollama is running
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  getModelName(tier: ModelTier): string {
    return tier === 'smart' ? this.smartModel : this.fastModel;
  }
}
