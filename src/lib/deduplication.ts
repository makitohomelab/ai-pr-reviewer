/**
 * Smart Deduplication Engine
 *
 * Provides intelligent duplicate detection for agent findings using
 * similarity scoring across multiple dimensions: message content,
 * file location, and finding category.
 */

import type { AgentFinding } from '../agents/base-agent.js';

/**
 * Calculate Levenshtein distance between two strings.
 * Used for fuzzy message comparison.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Calculate message similarity score (0-1).
 * Uses normalized Levenshtein distance.
 */
function messageSimilarity(a: string, b: string): number {
  const aLower = a.toLowerCase().trim();
  const bLower = b.toLowerCase().trim();

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
 * Deduplicate findings using similarity scoring.
 * Findings with similarity above threshold are considered duplicates.
 * When duplicates are found, the higher-priority finding is kept.
 *
 * @param findings - Array of findings to deduplicate
 * @returns Deduplicated array of findings
 */
export function deduplicateFindings(findings: AgentFinding[]): AgentFinding[] {
  if (findings.length === 0) return [];

  const result: AgentFinding[] = [];
  const threshold = 0.8; // Similarity threshold for deduplication

  const priorityOrder = { critical: 0, high: 1, medium: 2 };

  for (const finding of findings) {
    let isDuplicate = false;
    let duplicateIndex = -1;

    // Check against existing results
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
    } else {
      // Replace if new finding has higher priority
      const existing = result[duplicateIndex];
      if (priorityOrder[finding.priority] < priorityOrder[existing.priority]) {
        result[duplicateIndex] = finding;
      }
    }
  }

  return result;
}
