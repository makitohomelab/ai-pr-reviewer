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
  /** JSON schema for structured output (Ollama native API) */
  jsonSchema?: Record<string, unknown>;
  /** Temperature for generation (0 = deterministic) */
  temperature?: number;
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
 * Model capability for routing to specialized models based on task type.
 *
 * - 'code-review': Code analysis, bugs, style issues
 * - 'security': Security vulnerability detection
 * - 'reasoning': Complex multi-step reasoning
 * - 'fast': Quick tasks, maps to smaller/cheaper models
 * - 'smart': Complex tasks, maps to larger/more capable models
 */
export type ModelCapability =
  | 'code-review'
  | 'security'
  | 'reasoning'
  | 'fast'
  | 'smart';

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
   * @param capability - Optional model capability for routing (defaults to 'fast')
   */
  chat(params: ChatCompletionParams, capability?: ModelCapability): Promise<ChatCompletionResult>;

  /**
   * Check if the provider is available and configured correctly.
   * @returns true if the provider is ready to accept requests
   */
  healthCheck(): Promise<boolean>;

  /**
   * Get the model name for a given capability.
   * @param capability - Model capability
   * @returns The model name/identifier
   */
  getModelName(capability: ModelCapability): string;
}
