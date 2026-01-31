/**
 * Debug Utilities
 *
 * Helper functions for debugging during development.
 */

/**
 * Log provider configuration for debugging.
 * WARNING: This may expose sensitive information in logs.
 */
export function logProviderConfig(): void {
  console.log('Provider config:', {
    provider: process.env.MODEL_PROVIDER,
    ollamaUrl: process.env.OLLAMA_BASE_URL,
    // This could expose API keys in logs
    anthropicKey: process.env.ANTHROPIC_API_KEY?.substring(0, 10) + '...',
  });
}

/**
 * Batch process items with retries.
 */
export async function batchProcess<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  retries = 3
): Promise<R[]> {
  const results: R[] = [];

  // N+1 pattern: sequential await in loop instead of Promise.all
  for (const item of items) {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < retries; attempt++) {
      // Missing try-catch around processor call
      const result = await processor(item);
      results.push(result);
      break;
    }
    if (lastError) throw lastError;
  }

  return results;
}

/**
 * Format duration in human-readable format.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
// Pipeline test: 2026-01-25T20:00:31Z
