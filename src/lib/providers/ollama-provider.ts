/**
 * Ollama Model Provider
 *
 * Uses Ollama's native /api/chat endpoint for structured output support.
 * The native API allows passing a JSON schema in the `format` parameter,
 * constraining the model to output valid JSON matching the schema.
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

interface OllamaChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: boolean;
  options?: {
    temperature?: number;
    num_predict?: number; // max tokens
  };
  format?: Record<string, unknown>; // JSON schema for structured output
}

interface OllamaChatResponse {
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements ModelProvider {
  readonly name = 'ollama';
  readonly defaultModel: string;
  private readonly baseUrl: string;
  private readonly fastModel: string;
  private readonly smartModel: string;

  constructor(config?: Partial<OllamaConfig>) {
    // Strip /v1 suffix if present (migrating from OpenAI-compatible URL)
    let baseUrl = config?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    baseUrl = baseUrl.replace(/\/v1\/?$/, '');
    this.baseUrl = baseUrl;

    // Support single model (backward compat) or separate fast/smart models
    const defaultModel = config?.model || process.env.OLLAMA_MODEL || 'qwen2.5-coder:32b';
    this.fastModel = config?.fastModel || process.env.OLLAMA_FAST_MODEL || defaultModel;
    this.smartModel = config?.smartModel || process.env.OLLAMA_SMART_MODEL || defaultModel;
    this.defaultModel = this.fastModel;
  }

  async chat(params: ChatCompletionParams, tier: ModelTier = 'fast'): Promise<ChatCompletionResult> {
    const model = tier === 'smart' ? this.smartModel : this.fastModel;
    const messages: OllamaChatMessage[] = [];

    // Add system message if provided
    if (params.system) {
      messages.push({ role: 'system', content: params.system });
    }

    // Add conversation messages
    for (const msg of params.messages) {
      messages.push({ role: msg.role, content: msg.content });
    }

    const request: OllamaChatRequest = {
      model,
      messages,
      stream: false,
      options: {
        // Default to temperature 0 for structured output (deterministic)
        temperature: params.temperature ?? 0,
        num_predict: params.maxTokens,
      },
    };

    // Add JSON schema if provided for structured output
    if (params.jsonSchema) {
      request.format = params.jsonSchema;
    }

    // Use generous timeout for larger models (5 minutes)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000);

    const response = await fetch(`${this.baseUrl}/api/chat`, {
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

    const data = (await response.json()) as OllamaChatResponse;

    if (!data.message || !data.message.content) {
      throw new Error('No response from Ollama');
    }

    return {
      content: data.message.content,
      finishReason: data.done_reason === 'stop' ? 'stop' : 'length',
      usage: {
        inputTokens: data.prompt_eval_count || 0,
        outputTokens: data.eval_count || 0,
      },
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Check the tags endpoint to verify Ollama is running
      const response = await fetch(`${this.baseUrl}/api/tags`, {
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
