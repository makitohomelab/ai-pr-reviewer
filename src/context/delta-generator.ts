/**
 * PR Delta Generator
 *
 * Generates PR-specific context by matching changed files against
 * pre-computed patterns. This creates a focused context slice that
 * fits within token budgets.
 */

import { minimatch } from 'minimatch';
import type { FileChange } from '../lib/github.js';
import type { BaseContext, Pattern } from './context-loader.js';

/**
 * File category for grouping changed files.
 */
export interface FileCategory {
  name: string;
  files: string[];
  riskLevel: 'high' | 'medium' | 'low';
}

/**
 * Risk factor identified in the PR.
 */
export interface RiskFactor {
  type: 'security' | 'complexity' | 'scope' | 'breaking';
  description: string;
  severity: 'high' | 'medium' | 'low';
}

/**
 * PR-specific context delta.
 */
export interface PRDelta {
  /** Patterns that match changed files */
  changedPatterns: Pattern[];
  /** Files grouped by category */
  fileCategories: FileCategory[];
  /** Compact change signature */
  changeSignature: string;
  /** Identified risk factors */
  riskFactors: RiskFactor[];
}

/**
 * Known file categories with their risk levels.
 */
const FILE_CATEGORIES: Array<{
  name: string;
  patterns: string[];
  riskLevel: 'high' | 'medium' | 'low';
}> = [
  {
    name: 'Authentication/Security',
    patterns: ['**/auth/**', '**/security/**', '**/middleware/**', '**/*auth*', '**/*token*'],
    riskLevel: 'high',
  },
  {
    name: 'API/Endpoints',
    patterns: ['**/api/**', '**/routes/**', '**/endpoints/**', '**/controllers/**'],
    riskLevel: 'high',
  },
  {
    name: 'Configuration',
    patterns: ['**/*.config.*', '**/config/**', '**/.env*', '**/settings/**'],
    riskLevel: 'high',
  },
  {
    name: 'Core Logic',
    patterns: ['**/src/**/*.ts', '**/src/**/*.js', '**/lib/**'],
    riskLevel: 'medium',
  },
  {
    name: 'Tests',
    patterns: ['**/*.test.*', '**/*.spec.*', '**/test/**', '**/tests/**', '**/__tests__/**'],
    riskLevel: 'low',
  },
  {
    name: 'Documentation',
    patterns: ['**/*.md', '**/docs/**', '**/*.txt'],
    riskLevel: 'low',
  },
  {
    name: 'Build/CI',
    patterns: ['**/workflows/**', '**/.github/**', '**/Dockerfile*', '**/docker-compose*'],
    riskLevel: 'medium',
  },
];

/**
 * Check if a file matches any of the given glob patterns.
 */
function matchesPatterns(filename: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(filename, pattern, { matchBase: true }));
}

/**
 * Match a file against structured patterns.
 */
function matchStructuredPatterns(filename: string, patterns: Pattern[]): Pattern[] {
  return patterns.filter((pattern) =>
    pattern.files.some((glob) => minimatch(filename, glob, { matchBase: true }))
  );
}

/**
 * Categorize files into groups.
 */
function categorizeFiles(files: FileChange[]): FileCategory[] {
  const categories = new Map<string, FileCategory>();

  for (const file of files) {
    let matched = false;

    for (const cat of FILE_CATEGORIES) {
      if (matchesPatterns(file.filename, cat.patterns)) {
        if (!categories.has(cat.name)) {
          categories.set(cat.name, {
            name: cat.name,
            files: [],
            riskLevel: cat.riskLevel,
          });
        }
        categories.get(cat.name)!.files.push(file.filename);
        matched = true;
        break;
      }
    }

    // Uncategorized files
    if (!matched) {
      if (!categories.has('Other')) {
        categories.set('Other', { name: 'Other', files: [], riskLevel: 'low' });
      }
      categories.get('Other')!.files.push(file.filename);
    }
  }

  // Sort by risk level (high first)
  const riskOrder = { high: 0, medium: 1, low: 2 };
  return Array.from(categories.values()).sort(
    (a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel]
  );
}

/**
 * Generate compact change signature.
 */
function generateChangeSignature(files: FileChange[]): string {
  const extensions = new Map<string, number>();
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const file of files) {
    const ext = file.filename.split('.').pop() || 'unknown';
    extensions.set(ext, (extensions.get(ext) || 0) + 1);
    totalAdded += file.additions;
    totalRemoved += file.deletions;
  }

  const extSummary = Array.from(extensions.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([ext, count]) => `${count} .${ext}`)
    .join(', ');

  return `${files.length} files (${extSummary}), +${totalAdded}/-${totalRemoved} lines`;
}

/**
 * Identify risk factors from the PR.
 */
function identifyRiskFactors(
  files: FileChange[],
  patterns: Pattern[],
  categories: FileCategory[]
): RiskFactor[] {
  const risks: RiskFactor[] = [];

  // Check for high-risk categories
  const highRiskCategories = categories.filter((c) => c.riskLevel === 'high');
  if (highRiskCategories.length > 0) {
    risks.push({
      type: 'security',
      description: `Changes in security-sensitive areas: ${highRiskCategories.map((c) => c.name).join(', ')}`,
      severity: 'high',
    });
  }

  // Check for security patterns
  const securityPatterns = patterns.filter((p) => p.type === 'security');
  if (securityPatterns.length > 0) {
    risks.push({
      type: 'security',
      description: `Matched security patterns: ${securityPatterns.map((p) => p.id).join(', ')}`,
      severity: 'high',
    });
  }

  // Check for large scope
  const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  if (totalLines > 500) {
    risks.push({
      type: 'scope',
      description: `Large change scope: ${totalLines} lines across ${files.length} files`,
      severity: totalLines > 1000 ? 'high' : 'medium',
    });
  }

  // Check for anti-patterns
  const antiPatterns = patterns.filter((p) => p.type === 'anti-pattern');
  if (antiPatterns.length > 0) {
    risks.push({
      type: 'breaking',
      description: `Potential anti-patterns detected: ${antiPatterns.map((p) => p.id).join(', ')}`,
      severity: 'medium',
    });
  }

  return risks;
}

/**
 * Generate PR-specific context delta.
 *
 * @param context - Base context from .claude/context/
 * @param files - Changed files from the PR
 * @returns PRDelta with matched patterns and risk factors
 */
export function generatePRDelta(context: BaseContext, files: FileChange[]): PRDelta {
  // Match changed files against structured patterns
  const changedPatterns: Pattern[] = [];
  const seenPatterns = new Set<string>();

  for (const file of files) {
    const matched = matchStructuredPatterns(file.filename, context.structuredPatterns);
    for (const pattern of matched) {
      if (!seenPatterns.has(pattern.id)) {
        seenPatterns.add(pattern.id);
        changedPatterns.push(pattern);
      }
    }
  }

  // Sort by weight (highest first)
  changedPatterns.sort((a, b) => b.weight - a.weight);

  // Categorize files
  const fileCategories = categorizeFiles(files);

  // Generate change signature
  const changeSignature = generateChangeSignature(files);

  // Identify risk factors
  const riskFactors = identifyRiskFactors(files, changedPatterns, fileCategories);

  return {
    changedPatterns,
    fileCategories,
    changeSignature,
    riskFactors,
  };
}

/**
 * Format PR delta as context string for injection into prompts.
 */
export function formatDeltaAsContext(delta: PRDelta): string {
  const sections: string[] = [];

  // Change summary
  sections.push(`## Change Summary\n${delta.changeSignature}`);

  // File categories
  if (delta.fileCategories.length > 0) {
    const catLines = delta.fileCategories.map(
      (c) => `- **${c.name}** (${c.riskLevel} risk): ${c.files.length} files`
    );
    sections.push(`## File Categories\n${catLines.join('\n')}`);
  }

  // Risk factors
  if (delta.riskFactors.length > 0) {
    const riskLines = delta.riskFactors.map(
      (r) => `- **${r.type}** (${r.severity}): ${r.description}`
    );
    sections.push(`## Risk Factors\n${riskLines.join('\n')}`);
  }

  // Matched patterns
  if (delta.changedPatterns.length > 0) {
    const patternLines = delta.changedPatterns
      .slice(0, 5)
      .map((p) => `- **${p.id}**: ${p.description}`);
    sections.push(`## Relevant Patterns\n${patternLines.join('\n')}`);
  }

  return sections.join('\n\n');
}
