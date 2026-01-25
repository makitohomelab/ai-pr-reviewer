/**
 * Model Provider Factory
 *
 * Creates the appropriate ModelProvider based on environment configuration.
 *
 * Environment Variables:
 * - MODEL_PROVIDER: 'anthropic' (default) or 'ollama'
 * - OLLAMA_BASE_URL: Ollama API endpoint (default: http://localhost:11434/v1)
 * - OLLAMA_MODEL: Model to use with Ollama (default: llama3.2:3b)
 * - ANTHROPIC_API_KEY: Required for Anthropic provider
 */

import type { ModelProvider } from '../model-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OllamaProvider } from './ollama-provider.js';

export type ProviderType = 'anthropic' | 'ollama';

/**
 * Create a ModelProvider based on environment configuration.
 * @returns The configured ModelProvider instance
 */
export function createProvider(): ModelProvider {
  const providerType = (process.env.MODEL_PROVIDER || 'anthropic') as ProviderType;

  switch (providerType) {
    case 'ollama':
      return new OllamaProvider();

    case 'anthropic':
    default:
      return new AnthropicProvider();
  }
}

// Re-export types and classes for direct usage if needed
export { AnthropicProvider } from './anthropic-provider.js';
export { OllamaProvider } from './ollama-provider.js';
export type { ModelProvider } from '../model-provider.js';
