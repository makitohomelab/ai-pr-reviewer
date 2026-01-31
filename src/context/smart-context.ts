/**
 * Smart Context
 *
 * Fetches full source files for dependencies of changed files,
 * giving agents architectural context beyond just diff patches.
 */

import type { Octokit } from '@octokit/rest';
import type { FileChange, PRContext } from '../lib/github.js';
import { getFileContent } from '../lib/github.js';
import { resolveAllImports } from './import-resolver.js';
import { estimateTokens, truncateToTokenBudget } from './token-budget.js';

export interface SmartContext {
  /** Map of filepath → file content for imported source files */
  sourceFiles: Map<string, string>;
  /** Total estimated token count of source files */
  tokenCount: number;
}

export interface SmartContextOptions {
  /** Maximum token budget for source context */
  maxTokens: number;
  /** Whether smart context is enabled */
  enabled: boolean;
}

const DEFAULT_OPTIONS: SmartContextOptions = {
  maxTokens: 8000,
  enabled: true,
};

/**
 * Build smart context by fetching imports of changed files.
 */
export async function buildSmartContext(
  octokit: Octokit,
  context: PRContext,
  files: FileChange[],
  options: Partial<SmartContextOptions> = {}
): Promise<SmartContext> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!opts.enabled) {
    return { sourceFiles: new Map(), tokenCount: 0 };
  }

  // Step 1: Fetch full content of changed code files
  const changedFileContents = new Map<string, string>();
  const codeFiles = files.filter((f) =>
    /\.(ts|tsx|js|jsx)$/.test(f.filename) && f.status !== 'removed'
  );

  const fetchPromises = codeFiles.map(async (file) => {
    const content = await getFileContent(
      octokit,
      context.owner,
      context.repo,
      file.filename,
      context.headSha
    );
    if (content) {
      changedFileContents.set(file.filename, content);
    }
  });

  await Promise.all(fetchPromises);

  // Step 2: Resolve all local imports from changed files (grouped by base path)
  const importGroups = resolveAllImports(changedFileContents);

  if (importGroups.size === 0) {
    return { sourceFiles: new Map(), tokenCount: 0 };
  }

  // Step 3: Fetch imported files — try candidates in order, stop at first match per group
  const sourceFiles = new Map<string, string>();
  let totalTokens = 0;

  for (const [, candidates] of importGroups) {
    if (totalTokens >= opts.maxTokens) break;

    // Try each candidate path until one succeeds
    for (const candidatePath of candidates) {
      const content = await getFileContent(
        octokit,
        context.owner,
        context.repo,
        candidatePath,
        context.headSha
      );

      if (content) {
        const tokens = estimateTokens(content);

        if (totalTokens + tokens > opts.maxTokens) {
          const remaining = opts.maxTokens - totalTokens;
          const truncated = truncateToTokenBudget(content, remaining);
          sourceFiles.set(candidatePath, truncated);
          totalTokens += remaining;
        } else {
          sourceFiles.set(candidatePath, content);
          totalTokens += tokens;
        }
        break; // Found this import, move to next group
      }
    }
  }

  return { sourceFiles, tokenCount: totalTokens };
}

/**
 * Format smart context as a prompt section.
 */
export function formatSmartContext(smartContext: SmartContext): string {
  if (smartContext.sourceFiles.size === 0) return '';

  const sections: string[] = ['## Source Context\n\nFull source of imported modules for reference:'];

  for (const [filepath, content] of smartContext.sourceFiles) {
    const ext = filepath.split('.').pop() || 'ts';
    sections.push(`### ${filepath}\n\n\`\`\`${ext}\n${content}\n\`\`\``);
  }

  return sections.join('\n\n');
}
