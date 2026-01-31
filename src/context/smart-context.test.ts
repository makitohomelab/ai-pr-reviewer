import { describe, it, expect, vi } from 'vitest';
import { buildSmartContext, formatSmartContext } from './smart-context.js';
import type { FileChange, PRContext } from '../lib/github.js';

// Mock getFileContent
vi.mock('../lib/github.js', async () => {
  const actual = await vi.importActual('../lib/github.js');
  return {
    ...actual,
    getFileContent: vi.fn(),
  };
});

import { getFileContent } from '../lib/github.js';

const mockOctokit = {} as any;
const mockContext: PRContext = {
  owner: 'test',
  repo: 'repo',
  prNumber: 1,
  title: 'Test PR',
  body: '',
  author: 'user',
  baseSha: 'abc',
  headSha: 'def',
};

describe('buildSmartContext', () => {
  it('returns empty when disabled', async () => {
    const result = await buildSmartContext(mockOctokit, mockContext, [], {
      enabled: false,
    });
    expect(result.sourceFiles.size).toBe(0);
    expect(result.tokenCount).toBe(0);
  });

  it('returns empty for no code files', async () => {
    const files: FileChange[] = [
      {
        filename: 'README.md',
        status: 'modified',
        additions: 1,
        deletions: 0,
        patch: '+hello',
      },
    ];
    const result = await buildSmartContext(mockOctokit, mockContext, files);
    expect(result.sourceFiles.size).toBe(0);
  });

  it('fetches imports from changed files', async () => {
    const files: FileChange[] = [
      {
        filename: 'src/index.ts',
        status: 'modified',
        additions: 5,
        deletions: 2,
        patch: '+import { foo } from "./lib/foo.js";',
      },
    ];

    const mockGetFileContent = vi.mocked(getFileContent);
    // First call: fetch changed file content
    mockGetFileContent.mockResolvedValueOnce(
      'import { foo } from "./lib/foo.js";\nconsole.log(foo);'
    );
    // Second call: fetch imported file
    mockGetFileContent.mockResolvedValueOnce('export const foo = 42;');

    const result = await buildSmartContext(mockOctokit, mockContext, files);
    expect(result.sourceFiles.size).toBe(1);
    expect(result.tokenCount).toBeGreaterThan(0);
  });

  it('respects token budget', async () => {
    const files: FileChange[] = [
      {
        filename: 'src/index.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
      },
    ];

    const mockGetFileContent = vi.mocked(getFileContent);
    mockGetFileContent.mockResolvedValueOnce(
      'import { a } from "./a.js";\nimport { b } from "./b.js";'
    );
    // Large file for import a
    mockGetFileContent.mockResolvedValueOnce('x'.repeat(50000));

    const result = await buildSmartContext(mockOctokit, mockContext, files, {
      maxTokens: 100,
    });
    // Should be truncated
    expect(result.tokenCount).toBeLessThanOrEqual(100);
  });
});

describe('formatSmartContext', () => {
  it('returns empty string for no files', () => {
    expect(formatSmartContext({ sourceFiles: new Map(), tokenCount: 0 })).toBe('');
  });

  it('formats files as markdown code blocks', () => {
    const sourceFiles = new Map([['src/lib/utils.ts', 'export const x = 1;']]);
    const result = formatSmartContext({ sourceFiles, tokenCount: 10 });
    expect(result).toContain('## Source Context');
    expect(result).toContain('### src/lib/utils.ts');
    expect(result).toContain('```ts');
    expect(result).toContain('export const x = 1;');
  });
});
