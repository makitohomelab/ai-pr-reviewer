/**
 * AI PR Reviewer - Orchestrator
 *
 * Main entry point that:
 * 1. Receives PR context from GitHub Actions
 * 2. Fetches PR diff via GitHub API
 * 3. Checks escalation criteria
 * 4. Routes to specialized subagents
 * 5. Aggregates responses and posts PR comment
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
import {
  checkEscalation,
  type PRMetrics,
  type EscalationResult,
} from './lib/escalation.js';
import {
  runTestQualityAgent,
  formatFindingsAsMarkdown,
  type AgentResult,
} from './agents/test-quality.js';
import { createProvider, type ModelProvider } from './lib/providers/index.js';

interface ReviewResult {
  testQuality: AgentResult;
  escalation: EscalationResult;
}

async function runReview(
  provider: ModelProvider,
  context: PRContext,
  diff: PRDiff
): Promise<ReviewResult> {
  console.log(`📋 Reviewing PR #${context.prNumber}: ${context.title}`);
  console.log(`   Files changed: ${diff.files.length}`);
  console.log(`   Lines: +${diff.totalAdditions} -${diff.totalDeletions}`);

  // Run Test & Quality agent
  console.log('\n🔍 Running Test & Quality agent...');
  const testQualityResult = await runTestQualityAgent(
    provider,
    diff.files,
    context.title,
    context.body
  );
  console.log(`   Found ${testQualityResult.findings.length} findings`);
  console.log(`   Confidence: ${(testQualityResult.confidence * 100).toFixed(0)}%`);

  // Check escalation criteria
  const metrics: PRMetrics = {
    filesChanged: diff.files.map((f) => f.filename),
    linesAdded: diff.totalAdditions,
    linesRemoved: diff.totalDeletions,
  };

  const escalation = checkEscalation(metrics, testQualityResult.confidence);

  return {
    testQuality: testQualityResult,
    escalation,
  };
}

function buildReviewComment(result: ReviewResult): string {
  let comment = formatFindingsAsMarkdown(result.testQuality);

  // Add compact escalation notice if needed
  if (result.escalation.shouldEscalate) {
    const reasons = result.escalation.reasons.join(', ');
    comment += `\n\n⚠️ **Needs human review** (${result.escalation.severity}): ${reasons}`;
  }

  return comment;
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

  // Build and post comment
  const comment = buildReviewComment(result);
  console.log('\n💬 Posting review comment...');
  await postReviewComment(github, context, comment);

  // Add labels if escalation needed
  if (result.escalation.shouldEscalate) {
    console.log('🏷️  Adding escalation labels...');
    try {
      await addLabels(github, context, ['needs-human-review', `severity-${result.escalation.severity}`]);
    } catch (error) {
      // Labels might not exist, log but don't fail
      console.warn('   Could not add labels (they may not exist in the repo)');
    }
  }

  console.log('\n✅ Review complete!');

  // Exit with error if critical issues found
  const criticalFindings = result.testQuality.findings.filter(
    (f) => f.priority === 'critical'
  );
  if (criticalFindings.length > 0) {
    console.log(`\n⚠️  Found ${criticalFindings.length} critical issues`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Review failed:', error);
  process.exit(1);
});
// Test change
