import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QwenClient } from '../qwen-client.js';
import { OllamaProvider } from '../providers/ollama-provider.js';

vi.mock('../providers/ollama-provider.js', () => {
  const MockOllamaProvider = vi.fn();
  MockOllamaProvider.prototype.chat = vi.fn();
  MockOllamaProvider.prototype.healthCheck = vi.fn();
  MockOllamaProvider.prototype.getModelName = vi.fn().mockReturnValue('qwen2.5-coder:32b');
  return { OllamaProvider: MockOllamaProvider };
});

function getMock() {
  const instance = OllamaProvider.prototype;
  return {
    chat: vi.mocked(instance.chat),
    healthCheck: vi.mocked(instance.healthCheck),
  };
}

describe('QwenClient', () => {
  let client: QwenClient;
  let mock: ReturnType<typeof getMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new QwenClient();
    mock = getMock();
  });

  describe('ask()', () => {
    it('delegates to provider.chat and returns content', async () => {
      mock.chat.mockResolvedValue({
        content: 'The answer is 4',
        finishReason: 'stop',
      });

      const result = await client.ask('What is 2+2?');
      expect(result).toBe('The answer is 4');
      expect(mock.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'What is 2+2?' }],
          temperature: 0,
        }),
        'fast',
      );
    });

    it('passes system prompt when provided', async () => {
      mock.chat.mockResolvedValue({
        content: 'ok',
        finishReason: 'stop',
      });

      await client.ask('hi', { system: 'Be brief' });
      expect(mock.chat).toHaveBeenCalledWith(
        expect.objectContaining({ system: 'Be brief' }),
        'fast',
      );
    });
  });

  describe('query<T>()', () => {
    it('parses JSON from provider response', async () => {
      const data = { name: 'test', value: 42 };
      mock.chat.mockResolvedValue({
        content: JSON.stringify(data),
        finishReason: 'stop',
      });

      const result = await client.query<typeof data>('give me data', {
        type: 'object',
        properties: { name: { type: 'string' }, value: { type: 'number' } },
      });

      expect(result).toEqual(data);
    });

    it('passes schema as jsonSchema param', async () => {
      mock.chat.mockResolvedValue({
        content: '{}',
        finishReason: 'stop',
      });

      const schema = { type: 'object', properties: {} };
      await client.query('test', schema);
      expect(mock.chat).toHaveBeenCalledWith(
        expect.objectContaining({ jsonSchema: schema }),
        'fast',
      );
    });

    it('throws on malformed JSON with useful error', async () => {
      mock.chat.mockResolvedValue({
        content: 'not json at all',
        finishReason: 'stop',
      });

      await expect(
        client.query('test', { type: 'object' }),
      ).rejects.toThrow('Failed to parse structured response as JSON');
    });
  });

  describe('reviewDiff()', () => {
    it('returns parsed findings from provider response', async () => {
      mock.chat.mockResolvedValue({
        content: JSON.stringify({
          findings: [
            {
              priority: 'high',
              category: 'security',
              message: 'SQL injection risk',
              file: 'db.ts',
              line: 10,
            },
          ],
          summary: 'Found issues',
          confidence: 0.9,
        }),
        finishReason: 'stop',
      });

      const findings = await client.reviewDiff('+ const x = 1;');
      expect(findings).toHaveLength(1);
      expect(findings[0].agent).toBe('qwen-client');
      expect(findings[0].priority).toBe('high');
      expect(findings[0].message).toBe('SQL injection risk');
    });

    it('uses code-review capability', async () => {
      mock.chat.mockResolvedValue({
        content: JSON.stringify({ findings: [], summary: 'ok', confidence: 1 }),
        finishReason: 'stop',
      });

      await client.reviewDiff('diff');
      expect(mock.chat).toHaveBeenCalledWith(
        expect.anything(),
        'code-review',
      );
    });

    it('includes title in prompt when provided', async () => {
      mock.chat.mockResolvedValue({
        content: JSON.stringify({ findings: [], summary: 'ok', confidence: 1 }),
        finishReason: 'stop',
      });

      await client.reviewDiff('diff', { title: 'My PR' });
      const call = mock.chat.mock.calls[0][0];
      expect(call.messages[0].content).toContain('My PR');
    });
  });

  describe('isAvailable()', () => {
    it('delegates to healthCheck', async () => {
      mock.healthCheck.mockResolvedValue(true);
      expect(await client.isAvailable()).toBe(true);

      mock.healthCheck.mockResolvedValue(false);
      expect(await client.isAvailable()).toBe(false);
    });
  });
});
