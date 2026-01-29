import { describe, it, expect, vi } from 'vitest';
import { PipelineOrchestrator } from '../pipeline/pipeline-orchestrator.js';
import { filterUngroundedFindings } from '../pipeline/result-aggregator.js';
import type { ModelProvider } from '../lib/model-provider.js';
import type { BaseContext, PRDelta } from '../context/index.js';
import type { FileChange } from '../lib/github.js';
import type { AgentFinding } from '../agents/base-agent.js';

function createMockProvider(response: string): ModelProvider {
  return {
    name: 'mock',
    defaultModel: 'mock-model',
    chat: vi.fn().mockResolvedValue({
      content: response,
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
    healthCheck: vi.fn().mockResolvedValue(true),
    getModelName: vi.fn().mockReturnValue('mock-model'),
  };
}

const sampleContext: BaseContext = {
  repoPatterns: '',
  structuredPatterns: [],
  qwenPrompts: {
    securityPreamble: '',
    breakingPreamble: '',
    testCoveragePreamble: '',
    performancePreamble: '',
    codebaseQualityPreamble: '',
  },
  hasCustomContext: false,
};

const sampleDelta: PRDelta = {
  changeSignature: 'test',
  riskFactors: [],
  changedPatterns: [],
  fileCategories: [],
};

const sampleFiles: FileChange[] = [
  {
    filename: 'src/foo.ts',
    status: 'modified',
    additions: 5,
    deletions: 2,
    patch: '@@ -1,5 +1,8 @@\n+added line',
  },
];

const validAgentResponse = JSON.stringify({
  findings: [
    {
      priority: 'medium',
      category: 'test',
      message: 'Test finding',
      file: 'src/foo.ts',
    },
  ],
  summary: 'Test summary',
  confidence: 0.8,
});

describe('Pipeline Integration Tests', () => {
  describe('PipelineOrchestrator', () => {
    it('should aggregate findings from all agents when they return valid JSON', async () => {
      const provider = createMockProvider(validAgentResponse);
      const pipeline = new PipelineOrchestrator(provider);

      const result = await pipeline.run(
        sampleFiles,
        'Test PR',
        'Test body',
        sampleContext,
        sampleDelta
      );

      expect(result.findings.length).toBe(5);
      expect(result.findings.every((f: AgentFinding) => f.priority === 'medium')).toBe(true);
      expect(provider.chat).toHaveBeenCalledTimes(5);
    });

    it('should continue pipeline when one agent returns malformed JSON', async () => {
      const mockChat = vi
        .fn()
        .mockResolvedValueOnce({
          content: validAgentResponse,
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: 'not valid json at all',
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: validAgentResponse,
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: validAgentResponse,
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValueOnce({
          content: validAgentResponse,
          usage: { inputTokens: 100, outputTokens: 50 },
        });

      const provider: ModelProvider = {
        name: 'mock',
        defaultModel: 'mock-model',
        chat: mockChat,
        healthCheck: vi.fn().mockResolvedValue(true),
        getModelName: vi.fn().mockReturnValue('mock-model'),
      };

      const pipeline = new PipelineOrchestrator(provider);

      const result = await pipeline.run(
        sampleFiles,
        'Test PR',
        'Test body',
        sampleContext,
        sampleDelta
      );

      expect(result.findings.length).toBe(4);
      expect(mockChat).toHaveBeenCalledTimes(5);
    });

    it('should return empty findings when all agents return garbage', async () => {
      const provider = createMockProvider('complete garbage response');
      const pipeline = new PipelineOrchestrator(provider);

      const result = await pipeline.run(
        sampleFiles,
        'Test PR',
        'Test body',
        sampleContext,
        sampleDelta
      );

      expect(result.findings).toHaveLength(0);
      expect(provider.chat).toHaveBeenCalledTimes(5);
    });
  });

  describe('filterUngroundedFindings', () => {
    it('should keep findings with matching files and drop nonexistent files', () => {
      const findings: AgentFinding[] = [
        { agent: 'test', priority: 'high', category: 'test', message: 'Valid', file: 'src/foo.ts' },
        { agent: 'test', priority: 'medium', category: 'test', message: 'Invalid', file: 'nonexistent.ts' },
        { agent: 'test', priority: 'medium', category: 'test', message: 'No file' },
      ];

      const filtered = filterUngroundedFindings(findings, sampleFiles);

      expect(filtered).toHaveLength(2);
      expect(filtered[0].file).toBe('src/foo.ts');
      expect(filtered[1].file).toBeUndefined();
    });

    it('should keep all findings when no files specified in findings', () => {
      const findings: AgentFinding[] = [
        { agent: 'test', priority: 'high', category: 'test', message: 'Finding 1' },
        { agent: 'test', priority: 'medium', category: 'test', message: 'Finding 2' },
      ];

      const filtered = filterUngroundedFindings(findings, sampleFiles);
      expect(filtered).toHaveLength(2);
    });

    it('should return empty when all findings reference nonexistent files', () => {
      const findings: AgentFinding[] = [
        { agent: 'test', priority: 'high', category: 'test', message: 'Bad 1', file: 'nope.ts' },
        { agent: 'test', priority: 'medium', category: 'test', message: 'Bad 2', file: 'nah.ts' },
      ];

      const filtered = filterUngroundedFindings(findings, sampleFiles);
      expect(filtered).toHaveLength(0);
    });
  });
});
