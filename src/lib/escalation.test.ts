import { describe, it, expect } from 'vitest';
import {
  checkCriticalFiles,
  checkPRSize,
  checkEscalation,
  DEFAULT_CONFIG,
  type PRMetrics,
} from './escalation.js';

describe('checkCriticalFiles', () => {
  it('should detect security-sensitive files', () => {
    const files = ['src/app.ts', 'src/security/auth.ts', 'README.md'];
    const result = checkCriticalFiles(files);

    expect(result.matches).toBe(true);
    expect(result.matchedFiles).toContain('src/security/auth.ts');
  });

  it('should detect config files', () => {
    const files = ['src/index.ts', 'docker-compose.yml'];
    const result = checkCriticalFiles(files);

    expect(result.matches).toBe(true);
    expect(result.matchedFiles).toContain('docker-compose.yml');
  });

  it('should detect workflow files', () => {
    const files = ['.github/workflows/ci.yml'];
    const result = checkCriticalFiles(files);

    expect(result.matches).toBe(true);
    expect(result.matchedFiles).toContain('.github/workflows/ci.yml');
  });

  it('should detect package.json', () => {
    const files = ['package.json', 'src/utils.ts'];
    const result = checkCriticalFiles(files);

    expect(result.matches).toBe(true);
    expect(result.matchedFiles).toContain('package.json');
  });

  it('should not flag normal source files', () => {
    const files = ['src/components/Button.tsx', 'src/utils/helpers.ts'];
    const result = checkCriticalFiles(files);

    expect(result.matches).toBe(false);
    expect(result.matchedFiles).toHaveLength(0);
  });

  it('should detect .env files', () => {
    const files = ['.env.local', '.env.production'];
    const result = checkCriticalFiles(files);

    expect(result.matches).toBe(true);
    expect(result.matchedFiles.length).toBeGreaterThan(0);
  });

  it('should detect migration files', () => {
    const files = ['db/migrations/001_create_users.sql'];
    const result = checkCriticalFiles(files);

    expect(result.matches).toBe(true);
    expect(result.matchedFiles).toContain('db/migrations/001_create_users.sql');
  });
});

describe('checkPRSize', () => {
  it('should not flag small PRs', () => {
    const metrics: PRMetrics = {
      filesChanged: ['src/a.ts', 'src/b.ts'],
      linesAdded: 50,
      linesRemoved: 20,
    };

    const result = checkPRSize(metrics);
    expect(result.exceeds).toBe(false);
  });

  it('should flag PRs with too many lines changed', () => {
    const metrics: PRMetrics = {
      filesChanged: ['src/a.ts'],
      linesAdded: 400,
      linesRemoved: 200,
    };

    const result = checkPRSize(metrics);
    expect(result.exceeds).toBe(true);
    expect(result.reason).toContain('600 lines');
  });

  it('should flag PRs with too many files changed', () => {
    const metrics: PRMetrics = {
      filesChanged: Array.from({ length: 25 }, (_, i) => `file${i}.ts`),
      linesAdded: 10,
      linesRemoved: 5,
    };

    const result = checkPRSize(metrics);
    expect(result.exceeds).toBe(true);
    expect(result.reason).toContain('25 files');
  });

  it('should respect custom thresholds', () => {
    const metrics: PRMetrics = {
      filesChanged: ['src/a.ts'],
      linesAdded: 100,
      linesRemoved: 0,
    };

    const result = checkPRSize(metrics, { ...DEFAULT_CONFIG, maxLinesChanged: 50 });
    expect(result.exceeds).toBe(true);
  });
});

describe('checkEscalation', () => {
  it('should escalate for critical files', () => {
    const metrics: PRMetrics = {
      filesChanged: ['src/security/keys.ts'],
      linesAdded: 10,
      linesRemoved: 5,
    };

    const result = checkEscalation(metrics);
    expect(result.shouldEscalate).toBe(true);
    expect(result.severity).toBe('critical');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('should escalate for large PRs', () => {
    const metrics: PRMetrics = {
      filesChanged: Array.from({ length: 5 }, (_, i) => `src/file${i}.ts`),
      linesAdded: 400,
      linesRemoved: 200,
    };

    const result = checkEscalation(metrics);
    expect(result.shouldEscalate).toBe(true);
    expect(result.severity).toBe('high');
  });

  it('should escalate for low confidence', () => {
    const metrics: PRMetrics = {
      filesChanged: ['src/app.ts'],
      linesAdded: 10,
      linesRemoved: 5,
    };

    const result = checkEscalation(metrics, 0.3);
    expect(result.shouldEscalate).toBe(true);
    expect(result.reasons.some((r) => r.includes('confidence'))).toBe(true);
  });

  it('should not escalate for simple, safe PRs', () => {
    const metrics: PRMetrics = {
      filesChanged: ['src/utils/format.ts', 'src/utils/format.test.ts'],
      linesAdded: 30,
      linesRemoved: 10,
    };

    const result = checkEscalation(metrics, 0.9);
    expect(result.shouldEscalate).toBe(false);
    expect(result.severity).toBe('low');
  });

  it('should combine multiple escalation reasons', () => {
    const metrics: PRMetrics = {
      filesChanged: ['package.json', ...Array.from({ length: 25 }, (_, i) => `file${i}.ts`)],
      linesAdded: 400,
      linesRemoved: 200,
    };

    const result = checkEscalation(metrics, 0.4);
    expect(result.shouldEscalate).toBe(true);
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });
});
