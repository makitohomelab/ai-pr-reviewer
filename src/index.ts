/**
 * AI PR Reviewer - Orchestrator
 *
 * Main entry point that:
 * 1. Receives PR context from GitHub Actions
 * 2. Fetches PR diff via GitHub API
 * 3. Loads repo context from .claude/context/
 * 4. Runs specialized agents through pipeline (security → breaking → tests → performance)
 * 5. Aggregates and deduplicates findings
 * 6. Syncs learnings to repo-manager MCP
 * 7. Posts PR comment
 */

import {
  createGitHubClient,
  getPRContextFromEnv,
  getPRDiff,
  postReviewComment,
  addLabels,
  type PRContext,
  type PRDiff,
} from './lib/github.js';
import { createProvider, type ModelProvider } from './lib/providers/index.js';
import { loadBaseContext, generatePRDelta } from './context/index.js';
import {
  createPipeline,
  aggregateResults,
  formatAsMarkdown,
  syncToMCP,
  getMCPSyncConfig,
  formatSyncResult,
  type ExecutionMode,
  type PipelineResult,
  type AggregatedResult,
} from './pipeline/index.js';

export interface ReviewResult {
  pipeline: PipelineResult;
  aggregated: AggregatedResult;
}

export async function runReview(
  provider: ModelProvider,
  context: PRContext,
  diff: PRDiff
): Promise<ReviewResult> {
  console.log(`📋 Reviewing PR #${context.prNumber}: ${context.title}`);
  console.log(`   Files changed: ${diff.files.length}`);
  console.log(`   Lines: +${diff.totalAdditions} -${diff.totalDeletions}`);

  // Filter out non-reviewable files
  const reviewableFiles = diff.files.filter((f) => {
    const skip = [
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      '.min.js',
      '.min.css',
      '.map',
    ];
    return !skip.some((s) => f.filename.includes(s));
  });

  if (reviewableFiles.length === 0) {
    console.log('ℹ️  No reviewable files (only lock files or generated code)');
    return {
      pipeline: {
        findings: [],
        agentOutputs: [],
        summary: 'No reviewable code changes found.',
        confidence: 1.0,
        totalLatencyMs: 0,
        hasCritical: false,
        executionMode: 'sequential',
      },
      aggregated: {
        findings: [],
        summary: 'No reviewable code changes found.',
        confidence: 1.0,
        shouldEscalate: false,
        escalationReasons: [],
      },
    };
  }

  // Load repo context
  console.log('\n📂 Loading repository context...');
  const baseContext = await loadBaseContext(process.cwd());

  // Generate PR delta
  console.log('📊 Analyzing change patterns...');
  const prDelta = generatePRDelta(baseContext, reviewableFiles);
  console.log(`   Change signature: ${prDelta.changeSignature}`);
  console.log(`   Risk factors: ${prDelta.riskFactors.length}`);
  console.log(`   Matched patterns: ${prDelta.changedPatterns.length}`);

  // Create and run pipeline
  const executionMode = (process.env.PIPELINE_MODE || 'sequential') as ExecutionMode;
  const pipeline = createPipeline(provider, {
    executionMode,
    verbose: process.env.DEBUG_AI_REVIEW === 'true',
  });

  const pipelineResult = await pipeline.run(
    reviewableFiles,
    context.title,
    context.body,
    baseContext,
    prDelta
  );

  // Aggregate results
  const aggregated = aggregateResults(pipelineResult);

  return {
    pipeline: pipelineResult,
    aggregated,
  };
}

async function main(): Promise<void> {
  // Validate environment
  const githubToken = process.env.GITHUB_TOKEN;

  if (!githubToken) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }

  // Initialize clients
  const github = createGitHubClient(githubToken);
  const provider = createProvider();

  // Verify provider is available
  console.log(`\n🚀 AI PR Reviewer starting...`);
  console.log(`   Model provider: ${provider.name} (${provider.defaultModel})`);

  const providerReady = await provider.healthCheck();
  if (!providerReady) {
    throw new Error(`Model provider '${provider.name}' is not available. Check your configuration.`);
  }
  console.log(`   Provider health check: OK`);

  // Get PR context
  const context = getPRContextFromEnv();
  console.log(`   Repository: ${context.owner}/${context.repo}`);
  console.log(`   PR #${context.prNumber} by @${context.author}`);

  // Fetch PR diff
  console.log('\n📥 Fetching PR diff...');
  const diff = await getPRDiff(github, context);

  if (diff.files.length === 0) {
    console.log('ℹ️  No files changed, nothing to review.');
    await postReviewComment(
      github,
      context,
      '✅ No code changes to review.'
    );
    return;
  }

  // Run the review
  const result = await runReview(provider, context, diff);

  // Format and post comment
  const comment = formatAsMarkdown(result.aggregated);
  console.log('\n💬 Posting review comment...');
  await postReviewComment(github, context, comment);

  // Add labels if escalation needed
  if (result.aggregated.shouldEscalate) {
    console.log('🏷️  Adding escalation labels...');
    try {
      await addLabels(github, context, ['needs-human-review']);
    } catch {
      // Labels might not exist, log but don't fail
      console.warn('   Could not add labels (they may not exist in the repo)');
    }
  }

  // Sync to MCP
  const mcpConfig = getMCPSyncConfig();
  if (mcpConfig.enabled) {
    const syncResult = await syncToMCP(mcpConfig, result.aggregated);
    console.log(formatSyncResult(syncResult));
  }

  console.log('\n✅ Review complete!');

  // Exit with error if critical issues found
  if (result.pipeline.hasCritical) {
    const criticalCount = result.aggregated.findings.filter(
      (f) => f.priority === 'critical'
    ).length;
    console.log(`\n⚠️  Found ${criticalCount} critical issues`);
    process.exit(1);
  }
}

// Only run main() when this file is the entry point (not when imported)
import { fileURLToPath } from 'url';
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((error) => {
    console.error('❌ Review failed:', error);
    process.exit(1);
  });
}
