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

/**
 * Review comment from GitHub
 */
export interface ReviewComment {
  id: number;
  body: string;
  user: string;
  createdAt: string;
  path?: string;
  line?: number;
  inReplyToId?: number;
}

/**
 * PR review with comments
 */
export interface PRReview {
  id: number;
  body: string;
  user: string;
  state: string;
  submittedAt: string;
  comments: ReviewComment[];
}

/**
 * Get all reviews and comments on a PR
 */
export async function getPRReviews(
  octokit: Octokit,
  context: PRContext
): Promise<PRReview[]> {
  // Get reviews
  const { data: reviews } = await octokit.rest.pulls.listReviews({
    owner: context.owner,
    repo: context.repo,
    pull_number: context.prNumber,
  });

  // Get review comments
  const { data: comments } = await octokit.rest.pulls.listReviewComments({
    owner: context.owner,
    repo: context.repo,
    pull_number: context.prNumber,
    per_page: 100,
  });

  return reviews.map((review) => ({
    id: review.id,
    body: review.body || '',
    user: review.user?.login || 'unknown',
    state: review.state,
    submittedAt: review.submitted_at || '',
    comments: comments
      .filter((c) => c.pull_request_review_id === review.id)
      .map((c) => ({
        id: c.id,
        body: c.body,
        user: c.user?.login || 'unknown',
        createdAt: c.created_at,
        path: c.path,
        line: c.line ?? undefined,
        inReplyToId: c.in_reply_to_id ?? undefined,
      })),
  }));
}

/**
 * Get issue comments (general PR comments, not review comments)
 */
export async function getIssueComments(
  octokit: Octokit,
  context: PRContext
): Promise<ReviewComment[]> {
  const { data: comments } = await octokit.rest.issues.listComments({
    owner: context.owner,
    repo: context.repo,
    issue_number: context.prNumber,
    per_page: 100,
  });

  return comments.map((c) => ({
    id: c.id,
    body: c.body || '',
    user: c.user?.login || 'unknown',
    createdAt: c.created_at,
  }));
}

/**
 * Reaction types supported by GitHub
 */
export type ReactionType =
  | '+1'
  | '-1'
  | 'laugh'
  | 'confused'
  | 'heart'
  | 'hooray'
  | 'rocket'
  | 'eyes';

/**
 * Add a reaction to an issue comment
 */
export async function addCommentReaction(
  octokit: Octokit,
  context: PRContext,
  commentId: number,
  reaction: ReactionType
): Promise<void> {
  await octokit.rest.reactions.createForIssueComment({
    owner: context.owner,
    repo: context.repo,
    comment_id: commentId,
    content: reaction,
  });
}

/**
 * Add a reaction to a review comment
 */
export async function addReviewCommentReaction(
  octokit: Octokit,
  context: PRContext,
  commentId: number,
  reaction: ReactionType
): Promise<void> {
  await octokit.rest.reactions.createForPullRequestReviewComment({
    owner: context.owner,
    repo: context.repo,
    comment_id: commentId,
    content: reaction,
  });
}

/**
 * Reply to an issue comment (posts a new comment)
 */
export async function replyToIssueComment(
  octokit: Octokit,
  context: PRContext,
  body: string
): Promise<number> {
  const { data } = await octokit.rest.issues.createComment({
    owner: context.owner,
    repo: context.repo,
    issue_number: context.prNumber,
    body,
  });
  return data.id;
}

/**
 * Reply to a review comment (in the same thread)
 */
export async function replyToReviewComment(
  octokit: Octokit,
  context: PRContext,
  commentId: number,
  body: string
): Promise<number> {
  const { data } = await octokit.rest.pulls.createReplyForReviewComment({
    owner: context.owner,
    repo: context.repo,
    pull_number: context.prNumber,
    comment_id: commentId,
    body,
  });
  return data.id;
}

/**
 * PR merge status information
 */
export interface PRMergeStatus {
  mergeable: boolean;
  state: 'clean' | 'dirty' | 'blocked' | 'behind' | 'unknown';
  mergeableState: string;
}

/**
 * Result of a merge operation
 */
export interface MergeResult {
  sha: string;
  merged: boolean;
  message?: string;
}

/**
 * Get the merge status of a PR
 */
export async function getPRMergeStatus(
  octokit: Octokit,
  context: PRContext
): Promise<PRMergeStatus> {
  const { data: pr } = await octokit.rest.pulls.get({
    owner: context.owner,
    repo: context.repo,
    pull_number: context.prNumber,
  });

  // Map GitHub's mergeable_state to our simplified state
  let state: PRMergeStatus['state'];
  switch (pr.mergeable_state) {
    case 'clean':
      state = 'clean';
      break;
    case 'dirty':
    case 'unstable':
      state = 'dirty';
      break;
    case 'blocked':
      state = 'blocked';
      break;
    case 'behind':
      state = 'behind';
      break;
    default:
      state = 'unknown';
  }

  return {
    mergeable: pr.mergeable ?? false,
    state,
    mergeableState: pr.mergeable_state ?? 'unknown',
  };
}

/**
 * Merge a PR
 */
export async function mergePR(
  octokit: Octokit,
  context: PRContext,
  options: {
    method: 'merge' | 'squash' | 'rebase';
    commitTitle?: string;
    commitMessage?: string;
  }
): Promise<MergeResult> {
  try {
    const { data } = await octokit.rest.pulls.merge({
      owner: context.owner,
      repo: context.repo,
      pull_number: context.prNumber,
      merge_method: options.method,
      commit_title: options.commitTitle,
      commit_message: options.commitMessage,
    });

    return {
      sha: data.sha,
      merged: data.merged,
      message: data.message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      sha: '',
      merged: false,
      message: `Merge failed: ${message}`,
    };
  }
}

/**
 * Delete a branch after merge
 */
export async function deleteBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string
): Promise<boolean> {
  try {
    await octokit.rest.git.deleteRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the head branch name of a PR
 */
export async function getPRHeadBranch(
  octokit: Octokit,
  context: PRContext
): Promise<string> {
  const { data: pr } = await octokit.rest.pulls.get({
    owner: context.owner,
    repo: context.repo,
    pull_number: context.prNumber,
  });
  return pr.head.ref;
}
