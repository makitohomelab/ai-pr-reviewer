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
  type FileChange,
} from './lib/github.js';
import { createProvider } from './lib/providers/index.js';
import { runReview, type ReviewResult } from './index.js';

interface CLIArgs {
  pr?: number;
  repo?: string;
  output?: 'json' | 'markdown';
  help?: boolean;
  diff?: boolean;
  title?: string;
  eval?: boolean;
  benchmark?: boolean;
  verbose?: boolean;
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

export function parseArgs(argv: string[]): CLIArgs {
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
    } else if (arg === '--diff' || arg === '-d') {
      args.diff = true;
    } else if (arg === '--title' || arg === '-t') {
      args.title = argv[++i];
    } else if (arg === '--eval' || arg === '-e') {
      args.eval = true;
    } else if (arg === '--benchmark') {
      args.benchmark = true;
    } else if (arg === '--verbose' || arg === '-v') {
      args.verbose = true;
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
AI PR Reviewer CLI

Usage:
  ai-review --pr <number> --repo <owner/repo> [options]
  ai-review --diff --title "PR title" [--eval]
  ai-review --benchmark

Options:
  -p, --pr <number>        PR number to review (required for PR mode)
  -r, --repo <owner/repo>  Repository (required for PR mode)
  -o, --output <format>    Output format: json (default) or markdown
  -d, --diff               Read diff from stdin
  -t, --title <title>      PR title (used with --diff)
  -e, --eval               Run quality evaluation on results
  --benchmark              Run all benchmark fixtures
  -v, --verbose            Show detailed findings (with --benchmark)
  -h, --help               Show this help message

Environment:
  GITHUB_TOKEN          GitHub token for API access (required for PR mode)
  OLLAMA_URL            Ollama server URL (default: http://localhost:11434)

Examples:
  ai-review --pr 42 --repo myorg/myrepo
  ai-review --pr 42 --repo myorg/myrepo --output markdown
  cat pr.diff | ai-review --diff --title "My PR" --eval
  ai-review --benchmark
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

async function runBenchmark(verbose = false): Promise<void> {
  const { readFileSync, readdirSync } = await import('fs');
  const { join, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const { evaluateFindings, formatEvalReport } = await import('./eval/index.js');
  const { loadBaseContext, generatePRDelta } = await import('./context/index.js');
  const { createPipeline, aggregateResults } = await import('./pipeline/index.js');
  const provider = createProvider();
  const providerReady = await provider.healthCheck();
  if (!providerReady) {
    console.error(`Provider '${provider.name}' is not available.`);
    process.exit(1);
  }

  // Find fixtures
  const __dirname = dirname(fileURLToPath(import.meta.url));
  let fixturesDir = join(__dirname, 'eval', 'fixtures');

  let expectedFiles: string[];
  try {
    expectedFiles = readdirSync(fixturesDir).filter((f: string) => f.endsWith('-expected.json'));
  } catch {
    // Running from dist/ — fixtures are in src/
    fixturesDir = join(__dirname, '..', 'src', 'eval', 'fixtures');
    expectedFiles = readdirSync(fixturesDir).filter((f: string) => f.endsWith('-expected.json'));
  }

  console.log(`\n=== Benchmark Suite ===`);
  console.log(`Found ${expectedFiles.length} fixtures\n`);

  const results: Array<{ name: string; score: number; findings: number; pass: boolean }> = [];

  for (const expectedFile of expectedFiles) {
    const expectedPath = join(fixturesDir, expectedFile);
    const expected: {
      name: string; title: string; description: string;
      minFindings: number; maxFindings: number;
      diffFiles: string[]; unexpectedCategories?: string[];
    } = JSON.parse(readFileSync(expectedPath, 'utf-8'));

    // Find corresponding diff file
    const diffFile = `${expected.name}.diff`;
    const diffPath = join(fixturesDir, diffFile);

    let diffContent: string;
    try {
      diffContent = readFileSync(diffPath, 'utf-8');
    } catch {
      console.log(`  SKIP ${expected.name}: diff file not found (${diffFile})`);
      continue;
    }

    console.log(`--- ${expected.name} ---`);
    console.log(`  Title: ${expected.title}`);

    const files = parseDiffToFileChanges(diffContent);
    const baseContext = await loadBaseContext(process.cwd());
    const prDelta = generatePRDelta(baseContext, files);
    const pipeline = createPipeline(provider, { verbose: false });

    const pipelineResult = await pipeline.run(
      files,
      expected.title,
      '',
      baseContext,
      prDelta
    );

    const aggregated = aggregateResults(pipelineResult, files);
    const evalResult = evaluateFindings(
      aggregated.findings,
      expected.diffFiles,
      pipelineResult.agentOutputs
    );

    console.log(formatEvalReport(evalResult));

    if (verbose) {
      for (const f of aggregated.findings) {
        console.log(`  [${f.agent}] ${f.category} @ ${f.file || 'general'}${f.line ? ':' + f.line : ''}`);
        console.log(`    ${f.message}`);
        if (f.suggestion) console.log(`    Suggestion: ${f.suggestion}`);
      }
      if (aggregated.findings.length === 0) {
        console.log(`  (no findings)`);
      }
    }

    // Check expectations
    const findingCount = aggregated.findings.length;
    const inRange = findingCount >= expected.minFindings && findingCount <= expected.maxFindings;

    if (!inRange) {
      console.log(`  EXPECTATION FAIL: ${findingCount} findings (expected ${expected.minFindings}-${expected.maxFindings})`);
    } else {
      console.log(`  EXPECTATION PASS: ${findingCount} findings in range`);
    }

    results.push({
      name: expected.name,
      score: evalResult.score,
      findings: findingCount,
      pass: inRange && evalResult.score >= 60,
    });

    console.log('');
  }

  // Summary table
  console.log('=== Summary ===');
  console.log('Name'.padEnd(30) + 'Score'.padEnd(8) + 'Findings'.padEnd(10) + 'Pass');
  console.log('-'.repeat(56));
  for (const r of results) {
    console.log(
      r.name.padEnd(30) +
      String(r.score).padEnd(8) +
      String(r.findings).padEnd(10) +
      (r.pass ? 'PASS' : 'FAIL')
    );
  }

  const allPass = results.every((r) => r.pass);
  process.exit(allPass ? 0 : 1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.benchmark) {
    await runBenchmark(args.verbose);
    return;
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

    // Run eval if requested
    if (args.eval) {
      const { evaluateFindings, formatEvalReport } = await import('./eval/index.js');
      const diffFiles = diff.files.map((f) => f.filename);
      const evalResult = evaluateFindings(
        result.aggregated.findings,
        diffFiles,
        result.pipeline.agentOutputs
      );
      console.log('\n' + formatEvalReport(evalResult));
    }

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

export function parseDiffToFileChanges(diff: string): FileChange[] {
  if (!diff.trim()) return [];

  const fileSections = diff.split(/^(?=diff --git )/m).filter(s => s.trim());
  const files: FileChange[] = [];

  for (const section of fileSections) {
    const headerMatch = section.match(/^diff --git a\/.+ b\/(.+)$/m);
    if (!headerMatch) continue;

    const filename = headerMatch[1];

    let status: FileChange['status'] = 'modified';
    if (/^new file mode/m.test(section)) {
      status = 'added';
    } else if (/^deleted file mode/m.test(section)) {
      status = 'removed';
    } else if (/^rename from/m.test(section)) {
      status = 'renamed';
    }

    let additions = 0;
    let deletions = 0;

    const lines = section.split('\n');
    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('+')) additions++;
      else if (line.startsWith('-') && !line.startsWith('diff --git')) deletions++;
    }

    files.push({ filename, status, additions, deletions });
  }

  return files;
}

// Only run main() when executed directly, not when imported
const isDirectExecution = process.argv[1]?.endsWith('/cli.js') || process.argv[1]?.endsWith('/cli.ts');
if (isDirectExecution) {
  main();
}
