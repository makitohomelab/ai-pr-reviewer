/**
 * GitHub API helpers for PR review operations
 */

import { Octokit } from '@octokit/rest';

export interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
  title: string;
  body: string;
  author: string;
  baseSha: string;
  headSha: string;
}

export interface PRDiff {
  files: FileChange[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface FileChange {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  patch?: string;
  previousFilename?: string;
}

export function createGitHubClient(token: string): Octokit {
  return new Octokit({ auth: token });
}

/**
 * Get PR context from environment variables (set by GitHub Actions)
 */
export function getPRContextFromEnv(): PRContext {
  const required = ['PR_NUMBER', 'REPO_OWNER', 'REPO_NAME', 'BASE_SHA', 'HEAD_SHA'];
  for (const envVar of required) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  return {
    owner: process.env.REPO_OWNER!,
    repo: process.env.REPO_NAME!,
    prNumber: parseInt(process.env.PR_NUMBER!, 10),
    title: process.env.PR_TITLE || '',
    body: process.env.PR_BODY || '',
    author: process.env.PR_AUTHOR || 'unknown',
    baseSha: process.env.BASE_SHA!,
    headSha: process.env.HEAD_SHA!,
  };
}

/**
 * Fetch PR diff with file changes
 */
export async function getPRDiff(
  octokit: Octokit,
  context: PRContext
): Promise<PRDiff> {
  const { data: files } = await octokit.rest.pulls.listFiles({
    owner: context.owner,
    repo: context.repo,
    pull_number: context.prNumber,
    per_page: 100,
  });

  const fileChanges: FileChange[] = files.map((file) => ({
    filename: file.filename,
    status: file.status as FileChange['status'],
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
    previousFilename: file.previous_filename,
  }));

  return {
    files: fileChanges,
    totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
    totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
  };
}

/**
 * Post a review comment on the PR
 */
export async function postReviewComment(
  octokit: Octokit,
  context: PRContext,
  body: string,
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES' = 'COMMENT'
): Promise<void> {
  await octokit.rest.pulls.createReview({
    owner: context.owner,
    repo: context.repo,
    pull_number: context.prNumber,
    body,
    event,
  });
}

/**
 * Post an inline comment on a specific file/line
 */
export async function postInlineComment(
  octokit: Octokit,
  context: PRContext,
  filename: string,
  line: number,
  body: string,
  side: 'LEFT' | 'RIGHT' = 'RIGHT'
): Promise<void> {
  await octokit.rest.pulls.createReviewComment({
    owner: context.owner,
    repo: context.repo,
    pull_number: context.prNumber,
    body,
    path: filename,
    line,
    side,
    commit_id: context.headSha,
  });
}

/**
 * Add labels to the PR
 */
export async function addLabels(
  octokit: Octokit,
  context: PRContext,
  labels: string[]
): Promise<void> {
  await octokit.rest.issues.addLabels({
    owner: context.owner,
    repo: context.repo,
    issue_number: context.prNumber,
    labels,
  });
}

/**
 * Request review from specific users
 */
export async function requestReviewers(
  octokit: Octokit,
  context: PRContext,
  reviewers: string[]
): Promise<void> {
  await octokit.rest.pulls.requestReviewers({
    owner: context.owner,
    repo: context.repo,
    pull_number: context.prNumber,
    reviewers,
  });
}
