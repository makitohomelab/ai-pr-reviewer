/**
 * Escalation logic for determining when human intervention is needed.
 *
 * Criteria:
 * 1. File patterns - Changes to security-critical files
 * 2. Size/scope - Large PRs above thresholds
 * 3. Agent disagreement - When subagents have conflicting recommendations
 */

export interface EscalationConfig {
  /** File patterns that always require human review */
  criticalFilePatterns: string[];
  /** Maximum lines changed before escalation */
  maxLinesChanged: number;
  /** Maximum files changed before escalation */
  maxFilesChanged: number;
  /** Minimum confidence score (0-1) before escalation */
  minConfidenceScore: number;
}

export const DEFAULT_CONFIG: EscalationConfig = {
  criticalFilePatterns: [
    // Security-sensitive files that require human review
    '**/security/**',
    '**/.env*',
    '**/secrets/**',
    '**/credentials*',
    '**/auth/**',

    // Configuration
    '**/config/**',
    '**/*.config.*',
    '**/docker-compose*.yml',
    '**/Dockerfile*',
    '**/.github/workflows/**',

    // Database
    '**/migrations/**',
    '**/schema.*',

    // Package management
    'package.json',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
  ],
  maxLinesChanged: 500,
  maxFilesChanged: 20,
  minConfidenceScore: 0.7,
};

export interface PRMetrics {
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
}

export interface EscalationResult {
  shouldEscalate: boolean;
  reasons: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface SecurityVerdict {
  verdict: 'pass' | 'fail' | 'partial' | 'skipped';
  criticalCount: number;
  highCount: number;
}

/**
 * Simple glob pattern matching (supports * and **)
 * - ** matches any path segment(s) including none
 * - * matches any characters except /
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  // First, handle glob patterns by replacing them with placeholders
  let regexPattern = pattern
    // Replace **/ at the start (matches any path or no path)
    .replace(/^\*\*\//, '<<LEADING_GLOBSTAR>>')
    // Replace remaining ** with a placeholder
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    // Replace * with a placeholder
    .replace(/\*/g, '<<STAR>>');

  // Escape regex special characters
  regexPattern = regexPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');

  // Replace placeholders with regex patterns
  regexPattern = regexPattern
    // Leading **/ means "optionally any path prefix"
    .replace(/<<LEADING_GLOBSTAR>>/g, '(?:.*\\/)?')
    // ** matches any path segments
    .replace(/<<GLOBSTAR>>/g, '.*')
    // * matches any characters except /
    .replace(/<<STAR>>/g, '[^/]*');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}

/**
 * Check if any file matches critical patterns
 */
export function checkCriticalFiles(
  files: string[],
  patterns: string[] = DEFAULT_CONFIG.criticalFilePatterns
): { matches: boolean; matchedFiles: string[] } {
  const matchedFiles: string[] = [];

  for (const file of files) {
    for (const pattern of patterns) {
      if (matchesPattern(file, pattern)) {
        matchedFiles.push(file);
        break;
      }
    }
  }

  return {
    matches: matchedFiles.length > 0,
    matchedFiles,
  };
}

/**
 * Check if PR size exceeds thresholds
 */
export function checkPRSize(
  metrics: PRMetrics,
  config: EscalationConfig = DEFAULT_CONFIG
): { exceeds: boolean; reason?: string } {
  const totalLines = metrics.linesAdded + metrics.linesRemoved;

  if (totalLines > config.maxLinesChanged) {
    return {
      exceeds: true,
      reason: `PR changes ${totalLines} lines (threshold: ${config.maxLinesChanged})`,
    };
  }

  if (metrics.filesChanged.length > config.maxFilesChanged) {
    return {
      exceeds: true,
      reason: `PR changes ${metrics.filesChanged.length} files (threshold: ${config.maxFilesChanged})`,
    };
  }

  return { exceeds: false };
}

/**
 * Check if security verdict requires escalation
 */
export function checkSecurityEscalation(
  securityVerdict?: SecurityVerdict
): { shouldEscalate: boolean; reason?: string; severity: EscalationResult['severity'] } {
  if (!securityVerdict || securityVerdict.verdict === 'pass') {
    return { shouldEscalate: false, severity: 'low' };
  }

  if (securityVerdict.verdict === 'skipped') {
    return {
      shouldEscalate: true,
      reason: 'Security checks were skipped (MCP unavailable)',
      severity: 'medium',
    };
  }

  if (securityVerdict.criticalCount > 0) {
    return {
      shouldEscalate: true,
      reason: `${securityVerdict.criticalCount} critical security issue(s) found`,
      severity: 'critical',
    };
  }

  if (securityVerdict.highCount > 0) {
    return {
      shouldEscalate: true,
      reason: `${securityVerdict.highCount} high severity security issue(s) found`,
      severity: 'high',
    };
  }

  // Partial = some issues but not critical/high
  if (securityVerdict.verdict === 'partial') {
    return {
      shouldEscalate: false,
      severity: 'medium',
    };
  }

  return { shouldEscalate: false, severity: 'low' };
}

/**
 * Main escalation check - combines all criteria
 */
export function checkEscalation(
  metrics: PRMetrics,
  agentConfidence?: number,
  config: EscalationConfig = DEFAULT_CONFIG,
  securityVerdict?: SecurityVerdict
): EscalationResult {
  const reasons: string[] = [];
  let highestSeverity: EscalationResult['severity'] = 'low';

  // Check critical files
  const criticalCheck = checkCriticalFiles(metrics.filesChanged, config.criticalFilePatterns);
  if (criticalCheck.matches) {
    reasons.push(`Critical files modified: ${criticalCheck.matchedFiles.join(', ')}`);
    highestSeverity = 'critical';
  }

  // Check PR size
  const sizeCheck = checkPRSize(metrics, config);
  if (sizeCheck.exceeds && sizeCheck.reason) {
    reasons.push(sizeCheck.reason);
    if (highestSeverity !== 'critical') {
      highestSeverity = 'high';
    }
  }

  // Check agent confidence
  if (agentConfidence !== undefined && agentConfidence < config.minConfidenceScore) {
    reasons.push(`Low agent confidence: ${(agentConfidence * 100).toFixed(0)}% (threshold: ${config.minConfidenceScore * 100}%)`);
    if (highestSeverity === 'low') {
      highestSeverity = 'medium';
    }
  }

  // Check security verdict
  if (securityVerdict) {
    const securityCheck = checkSecurityEscalation(securityVerdict);
    if (securityCheck.shouldEscalate && securityCheck.reason) {
      reasons.push(securityCheck.reason);
      // Update severity based on security findings
      const severityOrder = ['low', 'medium', 'high', 'critical'];
      if (severityOrder.indexOf(securityCheck.severity) > severityOrder.indexOf(highestSeverity)) {
        highestSeverity = securityCheck.severity;
      }
    }
  }

  return {
    shouldEscalate: reasons.length > 0,
    reasons,
    severity: highestSeverity,
  };
}
