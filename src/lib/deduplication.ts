/**
 * Smart Deduplication Engine
 *
 * Provides intelligent duplicate detection for agent findings using
 * similarity scoring across multiple dimensions: message content,
 * file location, and finding category.
 */

import type { AgentFinding } from '../agents/base-agent.js';

/** Maximum message length for comparison (prevents memory issues) */
const MAX_MESSAGE_LENGTH = 200;

/** Default similarity threshold for deduplication */
const DEFAULT_THRESHOLD = 0.8;

/**
 * Deduplication statistics for debugging/logging.
 */
export interface DeduplicationStats {
  inputCount: number;
  outputCount: number;
  duplicatesRemoved: number;
  threshold: number;
}

/**
 * Calculate Levenshtein distance between two strings.
 * Uses optimized single-row algorithm to reduce memory from O(n*m) to O(min(n,m)).
 */
function levenshteinDistance(a: string, b: string): number {
  // Ensure a is the shorter string for memory optimization
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  // Use single array instead of matrix - O(min(n,m)) space
  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  let curr = new Array<number>(a.length + 1);

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i] + 1,
        curr[i - 1] + 1,
        prev[i - 1] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[a.length];
}

/**
 * Calculate message similarity score (0-1).
 * Uses normalized Levenshtein distance with truncation for long strings.
 */
function messageSimilarity(a: string, b: string): number {
  // Truncate long messages to prevent performance issues
  let aLower = a.toLowerCase().trim();
  let bLower = b.toLowerCase().trim();

  if (aLower.length > MAX_MESSAGE_LENGTH) {
    aLower = aLower.substring(0, MAX_MESSAGE_LENGTH);
  }
  if (bLower.length > MAX_MESSAGE_LENGTH) {
    bLower = bLower.substring(0, MAX_MESSAGE_LENGTH);
  }

  if (aLower === bLower) return 1;
  if (aLower.length === 0 || bLower.length === 0) return 0;

  const maxLen = Math.max(aLower.length, bLower.length);
  const distance = levenshteinDistance(aLower, bLower);

  return 1 - distance / maxLen;
}

/**
 * Calculate file/location similarity score (0-1).
 * Considers both file path and line number proximity.
 */
function locationSimilarity(a: AgentFinding, b: AgentFinding): number {
  // No file info = general finding, consider different
  if (!a.file && !b.file) return 0.5;
  if (!a.file || !b.file) return 0;

  // Different files = not duplicates
  if (a.file !== b.file) return 0;

  // Same file
  if (a.line === undefined && b.line === undefined) return 1;
  if (a.line === undefined || b.line === undefined) return 0.8;

  // Same file, check line proximity
  const lineDiff = Math.abs(a.line - b.line);
  if (lineDiff === 0) return 1;
  if (lineDiff <= 5) return 0.9;
  if (lineDiff <= 10) return 0.7;
  if (lineDiff <= 20) return 0.5;

  return 0.3;
}

/**
 * Calculate category similarity score (0-1).
 * Exact match or related categories.
 */
function categorySimilarity(a: AgentFinding, b: AgentFinding): number {
  if (a.category === b.category) return 1;

  // Related category mappings
  const relatedCategories: Record<string, string[]> = {
    'sql-injection': ['injection', 'security', 'input-validation'],
    'xss': ['injection', 'security', 'input-validation'],
    'hardcoded-secret': ['security', 'credentials'],
    'breaking-change': ['api-compatibility', 'versioning'],
    'missing-tests': ['test-coverage', 'quality'],
    'performance': ['optimization', 'efficiency'],
  };

  const aRelated = relatedCategories[a.category] || [];
  const bRelated = relatedCategories[b.category] || [];

  if (aRelated.includes(b.category) || bRelated.includes(a.category)) {
    return 0.7;
  }

  return 0;
}

/**
 * Calculate overall similarity between two findings.
 * Returns a score from 0 (completely different) to 1 (identical).
 *
 * Weights:
 * - Message similarity: 50%
 * - Location similarity: 30%
 * - Category similarity: 20%
 */
export function calculateSimilarity(a: AgentFinding, b: AgentFinding): number {
  const msgSim = messageSimilarity(a.message, b.message);
  const locSim = locationSimilarity(a, b);
  const catSim = categorySimilarity(a, b);

  return msgSim * 0.5 + locSim * 0.3 + catSim * 0.2;
}

/**
 * Group findings by file for faster bucket-based comparison.
 * Reduces comparisons by only comparing within the same file bucket.
 */
function groupByFile(findings: AgentFinding[]): Map<string, AgentFinding[]> {
  const groups = new Map<string, AgentFinding[]>();

  for (const finding of findings) {
    const key = finding.file || '__general__';
    const group = groups.get(key);
    if (group) {
      group.push(finding);
    } else {
      groups.set(key, [finding]);
    }
  }

  return groups;
}

/**
 * Deduplicate within a single bucket of findings.
 */
function deduplicateBucket(
  findings: AgentFinding[],
  threshold: number,
  priorityOrder: Record<string, number>
): AgentFinding[] {
  if (findings.length <= 1) return findings;

  const result: AgentFinding[] = [];

  for (const finding of findings) {
    let isDuplicate = false;
    let duplicateIndex = -1;

    for (let i = 0; i < result.length; i++) {
      const similarity = calculateSimilarity(finding, result[i]);
      if (similarity >= threshold) {
        isDuplicate = true;
        duplicateIndex = i;
        break;
      }
    }

    if (!isDuplicate) {
      result.push(finding);
    } else if (duplicateIndex >= 0) {
      const existing = result[duplicateIndex];
      if (priorityOrder[finding.priority] < priorityOrder[existing.priority]) {
        result[duplicateIndex] = finding;
      }
    }
  }

  return result;
}

/**
 * Deduplicate findings using similarity scoring.
 * Findings with similarity above threshold are considered duplicates.
 * When duplicates are found, the higher-priority finding is kept.
 *
 * Uses bucket-based optimization: findings are first grouped by file,
 * then deduplicated within each bucket. This reduces the worst-case
 * complexity from O(n²) to O(n * k²) where k is max findings per file.
 *
 * @param findings - Array of findings to deduplicate
 * @param options - Optional configuration
 * @returns Deduplicated array of findings
 */
export function deduplicateFindings(
  findings: AgentFinding[],
  options?: { threshold?: number }
): AgentFinding[] {
  if (findings.length === 0) return [];

  const threshold = options?.threshold
    ?? (parseFloat(process.env.DEDUP_THRESHOLD || '') || DEFAULT_THRESHOLD);

  const priorityOrder = { critical: 0, high: 1, medium: 2 };

  // Group by file for bucket-based optimization
  const groups = groupByFile(findings);

  // Deduplicate within each bucket
  const bucketResults: AgentFinding[][] = [];
  for (const bucket of groups.values()) {
    bucketResults.push(deduplicateBucket(bucket, threshold, priorityOrder));
  }

  // Flatten results
  const result = bucketResults.flat();

  // Cross-bucket deduplication for general findings that may overlap
  const generalBucket = groups.get('__general__');
  if (generalBucket && generalBucket.length > 0) {
    // General findings might be duplicates of file-specific ones
    return deduplicateBucket(result, threshold, priorityOrder);
  }

  return result;
}

/**
 * Deduplicate findings and return statistics.
 * Useful for debugging and logging deduplication effectiveness.
 */
export function deduplicateFindingsWithStats(
  findings: AgentFinding[],
  options?: { threshold?: number }
): { findings: AgentFinding[]; stats: DeduplicationStats } {
  const threshold = options?.threshold
    ?? (parseFloat(process.env.DEDUP_THRESHOLD || '') || DEFAULT_THRESHOLD);

  const deduplicated = deduplicateFindings(findings, { threshold });

  return {
    findings: deduplicated,
    stats: {
      inputCount: findings.length,
      outputCount: deduplicated.length,
      duplicatesRemoved: findings.length - deduplicated.length,
      threshold,
    },
  };
}
