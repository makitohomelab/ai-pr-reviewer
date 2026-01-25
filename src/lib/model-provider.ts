/**
 * Model Provider Interface
 *
 * Defines a common interface for LLM providers (Anthropic, Ollama, etc.)
 * allowing the application to switch between providers via configuration.
 */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatCompletionParams {
  messages: ChatMessage[];
  system?: string;
  maxTokens?: number;
}

export interface ChatCompletionResult {
  content: string;
  finishReason: 'stop' | 'length' | 'error';
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Model tier for routing to different models based on task complexity.
 * - 'fast': Use smaller/cheaper models for simple tasks
 * - 'smart': Use larger/more capable models for complex reasoning
 */
export type ModelTier = 'fast' | 'smart';

/**
 * Common interface for all LLM providers.
 */
export interface ModelProvider {
  /** Provider name for logging */
  name: string;

  /** Default model to use for this provider */
  defaultModel: string;

  /**
   * Send a chat completion request.
   * @param params - Chat parameters (messages, system prompt, etc.)
   * @param tier - Optional model tier for routing (defaults to 'fast')
   */
  chat(params: ChatCompletionParams, tier?: ModelTier): Promise<ChatCompletionResult>;

  /**
   * Check if the provider is available and configured correctly.
   * @returns true if the provider is ready to accept requests
   */
  healthCheck(): Promise<boolean>;

  /**
   * Get the model name for a given tier.
   * @param tier - Model tier
   * @returns The model name/identifier
   */
  getModelName(tier: ModelTier): string;
}
