/**
 * Codebase Quality Agent Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CodebaseQualityAgent,
  createCodebaseQualityAgent,
} from '../codebase-quality-agent.js';
import type { ModelProvider } from '../../lib/model-provider.js';
import type { StaticAnalysis } from '../../analysis/static-analyzer.js';
import type { InfraAnalysis } from '../../analysis/infra-analyzer.js';
import type { BaseContext, PRDelta } from '../../context/index.js';

// Mock provider
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

// Sample context
const sampleContext: BaseContext = {
  repoPatterns: '',
  structuredPatterns: [],
  qwenPrompts: {
    securityPreamble: '',
    breakingPreamble: '',
    testCoveragePreamble: '',
    performancePreamble: '',
    codebaseQualityPreamble: 'Check for complexity and duplication.',
  },
  hasCustomContext: true,
};

// Sample delta
const sampleDelta: PRDelta = {
  changedPatterns: [],
  fileCategories: [],
  changeSignature: '',
  riskFactors: [],
};

// Sample static analysis
const sampleStaticAnalysis: StaticAnalysis = {
  complexityHotspots: [
    {
      file: 'src/complex.ts',
      function: 'processData',
      cyclomatic: 12,
      nestingDepth: 4,
      line: 42,
    },
  ],
  unusedExports: [{ file: 'src/utils.ts', export: 'oldHelper', line: 10 }],
  duplicateCandidates: [],
  fileMetrics: {
    totalFiles: 5,
    totalLines: 800,
    avgComplexity: 4.2,
    largestFiles: [{ file: 'src/main.ts', lines: 300 }],
  },
  analyzedAt: '2024-01-01T00:00:00Z',
};

// Sample infra analysis
const sampleInfraAnalysis: InfraAnalysis = {
  containers: { total: 5, running: 5, unhealthy: [] },
  configDrift: { verdict: 'synced', driftCount: 0 },
  portExposure: { verdict: 'pass', unexpectedPorts: 0, missingPorts: 0 },
  networkHealth: {
    miniPcReachable: true,
    desktopReachable: true,
    tailscaleStatus: 'connected',
  },
  desktopWoken: false,
  analyzedAt: '2024-01-01T00:00:00Z',
  skipped: false,
};

describe('CodebaseQualityAgent', () => {
  let agent: CodebaseQualityAgent;
  let mockProvider: ModelProvider;

  beforeEach(() => {
    mockProvider = createMockProvider(
      JSON.stringify({
        findings: [
          {
            priority: 'high',
            category: 'complexity',
            file: 'src/new-feature.ts',
            line: 25,
            message: 'This function adds significant complexity to an already complex module',
            suggestion: 'Consider extracting helper functions',
          },
        ],
        summary: 'PR introduces complexity concerns in one file.',
        confidence: 0.85,
      })
    );
    agent = createCodebaseQualityAgent(mockProvider);
  });

  it('should create agent with correct config', () => {
    expect(agent.name).toBe('codebase-quality');
    expect(agent.priority).toBe(5); // Runs last
  });

  it('should run analysis and return findings', async () => {
    const result = await agent.run({
      files: [
        {
          filename: 'src/new-feature.ts',
          status: 'added',
          additions: 50,
          deletions: 0,
          patch: '+function newFeature() { /* complex code */ }',
        },
      ],
      prTitle: 'Add new feature',
      prBody: 'This PR adds a new feature.',
      baseContext: sampleContext,
      prDelta: sampleDelta,
      previousFindings: [],
    });

    expect(result.agent).toBe('codebase-quality');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].category).toBe('complexity');
    expect(result.findings[0].priority).toBe('high');
    expect(result.confidence).toBe(0.85);
  });

  it('should include static analysis in system prompt', async () => {
    agent.setAnalysisData(sampleStaticAnalysis, undefined);

    await agent.run({
      files: [
        {
          filename: 'src/test.ts',
          status: 'modified',
          additions: 10,
          deletions: 5,
          patch: 'test patch',
        },
      ],
      prTitle: 'Test PR',
      prBody: '',
      baseContext: sampleContext,
      prDelta: sampleDelta,
      previousFindings: [],
    });

    // Verify provider was called with system prompt containing analysis
    expect(mockProvider.chat).toHaveBeenCalled();
    const call = (mockProvider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    const systemPrompt = call[0].system as string;

    // Should include static analysis summary
    expect(systemPrompt).toContain('CODEBASE METRICS');
    expect(systemPrompt).toContain('5 files');
    expect(systemPrompt).toContain('processData');
  });

  it('should include infrastructure analysis when provided', async () => {
    agent.setAnalysisData(sampleStaticAnalysis, sampleInfraAnalysis);

    await agent.run({
      files: [
        {
          filename: 'docker-compose.yml',
          status: 'modified',
          additions: 5,
          deletions: 2,
          patch: 'test patch',
        },
      ],
      prTitle: 'Update Docker config',
      prBody: '',
      baseContext: sampleContext,
      prDelta: sampleDelta,
      previousFindings: [],
    });

    const call = (mockProvider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    const systemPrompt = call[0].system as string;

    // Should include infra analysis summary
    expect(systemPrompt).toContain('INFRASTRUCTURE STATUS');
    expect(systemPrompt).toContain('CONTAINERS');
  });

  it('should skip infra analysis when skipped', async () => {
    const skippedInfra: InfraAnalysis = {
      containers: { total: 0, running: 0, unhealthy: [], error: 'skipped' },
      configDrift: { verdict: 'error', driftCount: 0, error: 'skipped' },
      portExposure: {
        verdict: 'error',
        unexpectedPorts: 0,
        missingPorts: 0,
        error: 'skipped',
      },
      networkHealth: {
        miniPcReachable: false,
        desktopReachable: false,
        tailscaleStatus: 'unknown',
        error: 'skipped',
      },
      desktopWoken: false,
      analyzedAt: '2024-01-01T00:00:00Z',
      skipped: true,
      skipReason: 'No MCP client',
    };

    agent.setAnalysisData(sampleStaticAnalysis, skippedInfra);

    await agent.run({
      files: [
        {
          filename: 'src/test.ts',
          status: 'modified',
          additions: 10,
          deletions: 5,
          patch: 'test patch',
        },
      ],
      prTitle: 'Test PR',
      prBody: '',
      baseContext: sampleContext,
      prDelta: sampleDelta,
      previousFindings: [],
    });

    const call = (mockProvider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    const systemPrompt = call[0].system as string;

    // Should NOT include infra analysis when skipped
    expect(systemPrompt).not.toContain('INFRASTRUCTURE STATUS');
  });

  it('should include repo-specific quality preamble', async () => {
    await agent.run({
      files: [
        {
          filename: 'src/test.ts',
          status: 'modified',
          additions: 10,
          deletions: 5,
          patch: 'test patch',
        },
      ],
      prTitle: 'Test PR',
      prBody: '',
      baseContext: sampleContext,
      prDelta: sampleDelta,
      previousFindings: [],
    });

    const call = (mockProvider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    const systemPrompt = call[0].system as string;

    // Should include the preamble from context
    expect(systemPrompt).toContain('Check for complexity and duplication.');
  });

  it('should handle parsing errors gracefully', async () => {
    const badProvider = createMockProvider('not valid json');
    const badAgent = createCodebaseQualityAgent(badProvider);

    const result = await badAgent.run({
      files: [
        {
          filename: 'src/test.ts',
          status: 'modified',
          additions: 10,
          deletions: 5,
          patch: 'test patch',
        },
      ],
      prTitle: 'Test PR',
      prBody: '',
      baseContext: sampleContext,
      prDelta: sampleDelta,
      previousFindings: [],
    });

    // Should return empty findings, not throw
    expect(result.findings).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });

  it('should detect all valid categories', async () => {
    const allCategoriesProvider = createMockProvider(
      JSON.stringify({
        findings: [
          { priority: 'high', category: 'complexity', message: 'Test' },
          { priority: 'medium', category: 'duplication', message: 'Test' },
          { priority: 'medium', category: 'dead-code', message: 'Test' },
          { priority: 'high', category: 'pattern-drift', message: 'Test' },
          { priority: 'critical', category: 'infra-drift', message: 'Test' },
        ],
        summary: 'Multiple issues found.',
        confidence: 0.9,
      })
    );
    const allCategoriesAgent = createCodebaseQualityAgent(allCategoriesProvider);

    const result = await allCategoriesAgent.run({
      files: [
        {
          filename: 'src/test.ts',
          status: 'modified',
          additions: 10,
          deletions: 5,
          patch: 'test patch',
        },
      ],
      prTitle: 'Test PR',
      prBody: '',
      baseContext: sampleContext,
      prDelta: sampleDelta,
      previousFindings: [],
    });

    expect(result.findings).toHaveLength(5);
    const categories = result.findings.map((f) => f.category);
    expect(categories).toContain('complexity');
    expect(categories).toContain('duplication');
    expect(categories).toContain('dead-code');
    expect(categories).toContain('pattern-drift');
    expect(categories).toContain('infra-drift');
  });
});

describe('createCodebaseQualityAgent', () => {
  it('should create a valid agent instance', () => {
    const provider = createMockProvider('{}');
    const agent = createCodebaseQualityAgent(provider);

    expect(agent).toBeInstanceOf(CodebaseQualityAgent);
    expect(agent.name).toBe('codebase-quality');
  });
});
