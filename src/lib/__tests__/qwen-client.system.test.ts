/**
 * QwenClient System Tests
 *
 * These tests hit real Ollama on the desktop PC (Tailscale IP).
 * They auto-skip when the desktop is offline.
 *
 * To run: ensure desktop is awake (use wake_desktop MCP tool if needed)
 *   npx vitest run src/lib/__tests__/qwen-client.system.test.ts
 */

import { describe, it, expect } from 'vitest';
import { QwenClient } from '../qwen-client.js';

const DESKTOP_URL = 'http://100.108.144.37:11434';

async function checkOllama(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const ollamaReachable = await checkOllama(DESKTOP_URL);

describe.skipIf(!ollamaReachable)('QwenClient System Tests', () => {
  const client = new QwenClient({ baseUrl: DESKTOP_URL });

  it('health check passes', async () => {
    expect(await client.isAvailable()).toBe(true);
  }, 10_000);

  it('ask() returns coherent text', async () => {
    const answer = await client.ask('What is 2+2? Reply with just the number.');
    expect(answer).toContain('4');
  }, 60_000);

  it('query<T>() returns valid structured JSON', async () => {
    const schema = {
      type: 'object',
      properties: {
        capital: { type: 'string' },
        country: { type: 'string' },
      },
      required: ['capital', 'country'],
    };

    const result = await client.query<{ capital: string; country: string }>(
      'What is the capital of France? Return JSON with "capital" and "country" fields.',
      schema,
    );

    expect(result.capital).toBeTruthy();
    expect(result.country).toBeTruthy();
    expect(result.capital.toLowerCase()).toContain('paris');
  }, 60_000);

  it('reviewDiff() returns AgentFinding array', async () => {
    const diff = `
--- a/app.ts
+++ b/app.ts
@@ -1,3 +1,5 @@
+const password = "admin123";
 export function connect(url: string) {
-  return fetch(url);
+  return fetch(url + "?key=" + password);
 }
`.trim();

    const findings = await client.reviewDiff(diff, { title: 'Test diff' });
    expect(Array.isArray(findings)).toBe(true);
    // The diff has an obvious hardcoded password — expect at least one finding
    // but don't fail if the model misses it (model behavior varies)
  }, 60_000);
});
