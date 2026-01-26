import { describe, it, expect, vi } from 'vitest';
import { prepareMCPSync, type ExecuteMergeResult } from './response-executor.js';
import type { ResponseSession, FindingResponse, ParsedFinding } from './review-response.js';

describe('prepareMCPSync', () => {
  const createFinding = (
    agent: string,
    category: string,
    priority: 'critical' | 'high' | 'medium' = 'high'
  ): ParsedFinding => ({
    index: 0,
    agent,
    category,
    priority,
    message: `${agent} ${category} issue`,
    rawText: 'raw',
  });

  const createSession = (responses: FindingResponse[]): ResponseSession => ({
    prNumber: 42,
    reviewCommentId: 123,
    findings: responses.map((r) => r.finding),
    responses,
  });

  describe('learnings', () => {
    it('should collect learnings from accepted findings', () => {
      const session = createSession([
        { finding: createFinding('security', 'injection'), action: 'accept', comment: 'Fixed with parameterized query' },
        { finding: createFinding('tests', 'coverage'), action: 'accept' },
      ]);

      const { learnings } = prepareMCPSync(session);

      expect(learnings).toHaveLength(2);
      expect(learnings[0].pattern).toContain('[security/injection]');
      expect(learnings[0].context).toBe('Fixed with parameterized query');
      expect(learnings[1].context).toBe('Accepted finding from AI review');
    });

    it('should not include non-accepted findings in learnings', () => {
      const session = createSession([
        { finding: createFinding('security', 'xss'), action: 'ignore' },
        { finding: createFinding('performance', 'n+1'), action: 'todo' },
        { finding: createFinding('breaking', 'api'), action: 'comment' },
      ]);

      const { learnings } = prepareMCPSync(session);

      expect(learnings).toHaveLength(0);
    });
  });

  describe('decision', () => {
    it('should create decision when merge succeeded', () => {
      const session = createSession([
        { finding: createFinding('security', 'injection'), action: 'accept' },
      ]);
      const mergeResult: ExecuteMergeResult = {
        merged: true,
        sha: 'abc123def456',
        branchDeleted: true,
      };

      const { decision } = prepareMCPSync(session, mergeResult);

      expect(decision).toBeDefined();
      expect(decision?.title).toContain('PR #42');
      expect(decision?.rationale).toContain('1 findings');
      expect(decision?.outcome).toContain('abc123def456');
    });

    it('should not create decision when merge failed', () => {
      const session = createSession([]);
      const mergeResult: ExecuteMergeResult = {
        merged: false,
        branchDeleted: false,
        message: 'Blocked by critical findings',
      };

      const { decision } = prepareMCPSync(session, mergeResult);

      expect(decision).toBeUndefined();
    });

    it('should not create decision when no merge attempted', () => {
      const session = createSession([]);

      const { decision } = prepareMCPSync(session);

      expect(decision).toBeUndefined();
    });
  });

  describe('review summary', () => {
    it('should calculate correct stats', () => {
      const session = createSession([
        { finding: createFinding('security', 'a'), action: 'accept' },
        { finding: createFinding('security', 'b'), action: 'accept' },
        { finding: createFinding('tests', 'c'), action: 'todo' },
        { finding: createFinding('perf', 'd'), action: 'ignore' },
        { finding: createFinding('breaking', 'e'), action: 'comment' },
      ]);

      const { review } = prepareMCPSync(session);

      expect(review.prNumber).toBe(42);
      expect(review.stats.total).toBe(5);
      expect(review.stats.accepted).toBe(2);
      expect(review.stats.todo).toBe(1);
      expect(review.stats.ignored).toBe(1);
      expect(review.stats.commented).toBe(1);
    });

    it('should generate human-readable summary', () => {
      const session = createSession([
        { finding: createFinding('security', 'a'), action: 'accept' },
        { finding: createFinding('tests', 'b'), action: 'todo' },
      ]);

      const { review } = prepareMCPSync(session);

      expect(review.summary).toContain('2 findings');
      expect(review.summary).toContain('1 accepted');
      expect(review.summary).toContain('1 deferred');
    });

    it('should handle empty session', () => {
      const session = createSession([]);

      const { review } = prepareMCPSync(session);

      expect(review.stats.total).toBe(0);
      expect(review.stats.accepted).toBe(0);
    });
  });
});
