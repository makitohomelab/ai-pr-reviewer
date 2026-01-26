#!/usr/bin/env node
/**
 * AI PR Reviewer - CLI Entry Point
 *
 * Standalone CLI for running PR reviews with JSON output.
 * Used by MCP tools and direct invocation.
 *
 * Usage:
 *   node dist/cli.js --pr 123 --repo owner/repo --output json
 *   node dist/cli.js --help
 */

import {
  createGitHubClient,
  getPRDiff,
  type PRContext,
} from './lib/github.js';
import { createProvider } from './lib/providers/index.js';
import { runReview, type ReviewResult } from './index.js';

interface CLIArgs {
  pr?: number;
  repo?: string;
  output?: 'json' | 'markdown';
  help?: boolean;
}

interface CLIOutput {
  success: boolean;
  pr_number?: number;
  repo?: string;
  findings?: Array<{
    agent: string;
    priority: string;
    category: string;
    file?: string;
    line?: number;
    message: string;
    suggestion?: string;
  }>;
  summary?: string;
  should_escalate?: boolean;
  escalation_reasons?: string[];
  confidence?: number;
  error?: string;
  hint?: string;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {};

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--pr' || arg === '-p') {
      const value = argv[++i];
      args.pr = value ? parseInt(value, 10) : undefined;
    } else if (arg === '--repo' || arg === '-r') {
      args.repo = argv[++i];
    } else if (arg === '--output' || arg === '-o') {
      const value = argv[++i];
      if (value === 'json' || value === 'markdown') {
        args.output = value;
      }
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
AI PR Reviewer CLI

Usage:
  ai-review --pr <number> --repo <owner/repo> [options]

Options:
  -p, --pr <number>     PR number to review (required)
  -r, --repo <owner/repo>  Repository (required)
  -o, --output <format>    Output format: json (default) or markdown
  -h, --help              Show this help message

Environment:
  GITHUB_TOKEN          GitHub token for API access (required)
  OLLAMA_URL            Ollama server URL (default: http://localhost:11434)

Examples:
  ai-review --pr 42 --repo myorg/myrepo
  ai-review --pr 42 --repo myorg/myrepo --output markdown
`);
}

function outputJSON(result: CLIOutput): void {
  console.log(JSON.stringify(result, null, 2));
}

function outputError(error: string, hint?: string): void {
  outputJSON({
    success: false,
    error,
    hint,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Validate required args
  if (!args.pr || isNaN(args.pr)) {
    outputError('PR number is required', 'Use --pr <number>');
    process.exit(1);
  }

  if (!args.repo) {
    outputError('Repository is required', 'Use --repo <owner/repo>');
    process.exit(1);
  }

  // Parse owner/repo
  const [owner, repo] = args.repo.split('/');
  if (!owner || !repo) {
    outputError('Invalid repository format', 'Use format: owner/repo');
    process.exit(1);
  }

  // Check environment
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    outputError('GITHUB_TOKEN not set', 'Set GITHUB_TOKEN environment variable');
    process.exit(1);
  }

  try {
    // Initialize clients
    const github = createGitHubClient(githubToken);
    const provider = createProvider();

    // Check provider health
    const providerReady = await provider.healthCheck();
    if (!providerReady) {
      outputError(
        `Model provider '${provider.name}' is not available`,
        'Check Ollama is running: curl http://localhost:11434/api/tags'
      );
      process.exit(1);
    }

    // Fetch PR details
    const { data: prData } = await github.rest.pulls.get({
      owner,
      repo,
      pull_number: args.pr,
    });

    const context: PRContext = {
      owner,
      repo,
      prNumber: args.pr,
      title: prData.title,
      body: prData.body || '',
      author: prData.user?.login || 'unknown',
      baseSha: prData.base.sha,
      headSha: prData.head.sha,
    };

    // Fetch diff
    const diff = await getPRDiff(github, context);

    if (diff.files.length === 0) {
      outputJSON({
        success: true,
        pr_number: args.pr,
        repo: args.repo,
        findings: [],
        summary: 'No files changed',
        should_escalate: false,
        escalation_reasons: [],
        confidence: 1.0,
      });
      return;
    }

    // Run review
    const result: ReviewResult = await runReview(provider, context, diff);

    // Output result
    const output: CLIOutput = {
      success: true,
      pr_number: args.pr,
      repo: args.repo,
      findings: result.aggregated.findings.map(f => ({
        agent: f.agent,
        priority: f.priority,
        category: f.category,
        file: f.file,
        line: f.line,
        message: f.message,
        suggestion: f.suggestion,
      })),
      summary: result.aggregated.summary,
      should_escalate: result.aggregated.shouldEscalate,
      escalation_reasons: result.aggregated.escalationReasons,
      confidence: result.aggregated.confidence,
    };

    if (args.output === 'markdown') {
      // Import and use markdown formatter
      const { formatAsMarkdown } = await import('./pipeline/index.js');
      console.log(formatAsMarkdown(result.aggregated));
    } else {
      outputJSON(output);
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Handle specific error cases
    if (message.includes('Not Found')) {
      outputError(`PR #${args.pr} not found in ${args.repo}`);
    } else if (message.includes('Bad credentials')) {
      outputError('GitHub authentication failed', 'Check GITHUB_TOKEN is valid');
    } else {
      outputError(message);
    }

    process.exit(1);
  }
}

main();
