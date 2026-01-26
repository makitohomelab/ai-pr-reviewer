import { describe, it, expect } from 'vitest';
import {
  parseReviewFindings,
  formatResponseSummary,
  formatInlineReply,
  findAIReviewComment,
  suggestAction,
  canMerge,
  ACTION_REACTIONS,
  type ParsedFinding,
  type FindingResponse,
} from './review-response.js';

describe('parseReviewFindings', () => {
  it('should parse critical security finding', () => {
    const reviewBody = `## AI Review

### Issues Found

🔴 **[security/injection]** SQL query uses string concatenation in \`src/db/query.ts:42\`
💡 *Suggestion:* Use parameterized queries`;

    const findings = parseReviewFindings(reviewBody);

    expect(findings).toHaveLength(1);
    expect(findings[0].agent).toBe('security');
    expect(findings[0].category).toBe('injection');
    expect(findings[0].priority).toBe('critical');
    expect(findings[0].file).toBe('src/db/query.ts');
    expect(findings[0].line).toBe(42);
    expect(findings[0].suggestion).toContain('parameterized');
  });

  it('should parse high priority finding', () => {
    const reviewBody = `🟠 **[breaking/api-change]** Removed required field from response in \`src/api/users.ts\``;

    const findings = parseReviewFindings(reviewBody);

    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('high');
    expect(findings[0].agent).toBe('breaking');
    expect(findings[0].category).toBe('api-change');
  });

  it('should parse medium priority finding', () => {
    const reviewBody = `🟡 **[tests/coverage]** Missing unit tests for error handling`;

    const findings = parseReviewFindings(reviewBody);

    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('medium');
    expect(findings[0].agent).toBe('tests');
    expect(findings[0].file).toBeUndefined();
  });

  it('should parse multiple findings', () => {
    const reviewBody = `## AI Review

🔴 **[security/xss]** Unescaped user input in \`src/components/Comment.tsx:15\`
🟠 **[performance/n+1]** N+1 query detected in \`src/api/posts.ts:88\`
🟡 **[tests/coverage]** Low test coverage for new module`;

    const findings = parseReviewFindings(reviewBody);

    expect(findings).toHaveLength(3);
    expect(findings[0].priority).toBe('critical');
    expect(findings[1].priority).toBe('high');
    expect(findings[2].priority).toBe('medium');
  });

  it('should handle empty review body', () => {
    const findings = parseReviewFindings('No issues found. LGTM!');
    expect(findings).toHaveLength(0);
  });

  it('should extract file without line number', () => {
    const reviewBody = `🟠 **[breaking/removed]** Deprecated function removed in \`src/legacy.ts\``;

    const findings = parseReviewFindings(reviewBody);

    expect(findings[0].file).toBe('src/legacy.ts');
    expect(findings[0].line).toBeUndefined();
  });
});

describe('canMerge', () => {
  const createFinding = (priority: 'critical' | 'high' | 'medium'): ParsedFinding => ({
    index: 0,
    agent: 'security',
    category: 'test',
    priority,
    message: 'Test finding',
    rawText: 'raw',
  });

  it('should allow merge when all critical findings are accepted', () => {
    const responses: FindingResponse[] = [
      { finding: createFinding('critical'), action: 'accept' },
      { finding: createFinding('high'), action: 'ignore' },
      { finding: createFinding('medium'), action: 'todo' },
    ];

    const result = canMerge(responses);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should block merge when critical finding is ignored', () => {
    const responses: FindingResponse[] = [
      { finding: createFinding('critical'), action: 'ignore' },
    ];

    const result = canMerge(responses);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('critical');
    expect(result.reason).toContain('not addressed');
  });

  it('should block merge when critical finding is deferred to todo', () => {
    const responses: FindingResponse[] = [
      { finding: createFinding('critical'), action: 'todo' },
    ];

    const result = canMerge(responses);

    expect(result.allowed).toBe(false);
  });

  it('should allow merge when no critical findings exist', () => {
    const responses: FindingResponse[] = [
      { finding: createFinding('high'), action: 'ignore' },
      { finding: createFinding('medium'), action: 'ignore' },
    ];

    const result = canMerge(responses);

    expect(result.allowed).toBe(true);
  });

  it('should allow merge with empty responses', () => {
    const result = canMerge([]);
    expect(result.allowed).toBe(true);
  });

  it('should list all unaddressed critical findings in reason', () => {
    const criticalFinding1: ParsedFinding = {
      ...createFinding('critical'),
      agent: 'security',
      category: 'injection',
    };
    const criticalFinding2: ParsedFinding = {
      ...createFinding('critical'),
      agent: 'security',
      category: 'xss',
    };

    const responses: FindingResponse[] = [
      { finding: criticalFinding1, action: 'comment' },
      { finding: criticalFinding2, action: 'todo' },
    ];

    const result = canMerge(responses);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('[security/injection]');
    expect(result.reason).toContain('[security/xss]');
    expect(result.reason).toContain('2 critical');
  });
});

describe('formatResponseSummary', () => {
  const createResponse = (
    action: FindingResponse['action'],
    agent = 'security',
    category = 'test'
  ): FindingResponse => ({
    finding: {
      index: 0,
      agent,
      category,
      priority: 'high',
      message: 'Test message',
      rawText: 'raw',
    },
    action,
  });

  it('should format accepted findings', () => {
    const responses = [createResponse('accept')];
    const summary = formatResponseSummary(responses);

    expect(summary).toContain('## Response to AI Review');
    expect(summary).toContain('### Accepted (Will Fix)');
    expect(summary).toContain('[security/test]');
  });

  it('should format deferred findings', () => {
    const responses = [createResponse('todo')];
    const summary = formatResponseSummary(responses);

    expect(summary).toContain('### Deferred (TODO)');
  });

  it('should format discussed findings', () => {
    const responses = [{ ...createResponse('comment'), comment: 'Need clarification' }];
    const summary = formatResponseSummary(responses);

    expect(summary).toContain('### Discussing');
    expect(summary).toContain('Need clarification');
  });

  it('should format ignored findings', () => {
    const responses = [createResponse('ignore')];
    const summary = formatResponseSummary(responses);

    expect(summary).toContain('### Acknowledged (No Action)');
  });

  it('should include summary stats', () => {
    const responses = [
      createResponse('accept'),
      createResponse('accept'),
      createResponse('todo'),
      createResponse('ignore'),
    ];
    const summary = formatResponseSummary(responses);

    expect(summary).toContain('2 accepted');
    expect(summary).toContain('1 deferred');
    expect(summary).toContain('1 acknowledged');
  });

  it('should include commit SHA when present', () => {
    const responses: FindingResponse[] = [
      { ...createResponse('accept'), commitSha: 'abc1234567890' },
    ];
    const summary = formatResponseSummary(responses);

    expect(summary).toContain('abc1234');
  });
});

describe('formatInlineReply', () => {
  it('should format accept reply', () => {
    const reply = formatInlineReply('accept', 'Fixed by using prepared statements');

    expect(reply).toContain('**Action:** Will fix');
    expect(reply).toContain('Fixed by using prepared statements');
  });

  it('should format todo reply', () => {
    const reply = formatInlineReply('todo');

    expect(reply).toContain('Added to TODO');
  });

  it('should format ignore reply', () => {
    const reply = formatInlineReply('ignore', 'False positive - input is already sanitized');

    expect(reply).toContain('no action needed');
    expect(reply).toContain('False positive');
  });

  it('should format comment reply', () => {
    const reply = formatInlineReply('comment', 'Can you clarify what vulnerability this refers to?');

    expect(reply).toContain('**Response:**');
    expect(reply).toContain('Can you clarify');
  });
});

describe('findAIReviewComment', () => {
  it('should find comment with AI Review header', () => {
    const comments = [
      { id: 1, body: 'Thanks for the PR!', user: 'reviewer' },
      { id: 2, body: '## AI Review\n\nNo issues found.', user: 'bot' },
    ];

    const result = findAIReviewComment(comments);

    expect(result).toBeDefined();
    expect(result?.id).toBe(2);
  });

  it('should find comment with Issues Found section', () => {
    const comments = [
      { id: 1, body: 'LGTM', user: 'reviewer' },
      { id: 2, body: 'Review summary\n### Issues Found\n- Issue 1', user: 'bot' },
    ];

    const result = findAIReviewComment(comments);

    expect(result?.id).toBe(2);
  });

  it('should find comment with finding pattern', () => {
    const comments = [
      { id: 1, body: '🔴 **[security/xss]** Found XSS vulnerability', user: 'bot' },
    ];

    const result = findAIReviewComment(comments);

    expect(result?.id).toBe(1);
  });

  it('should return undefined when no AI review found', () => {
    const comments = [
      { id: 1, body: 'Nice work!', user: 'reviewer' },
      { id: 2, body: 'Approved', user: 'maintainer' },
    ];

    const result = findAIReviewComment(comments);

    expect(result).toBeUndefined();
  });
});

describe('suggestAction', () => {
  it('should suggest accept for critical security issues', () => {
    const finding: ParsedFinding = {
      index: 0,
      agent: 'security',
      category: 'injection',
      priority: 'critical',
      message: 'SQL injection',
      rawText: 'raw',
    };

    const result = suggestAction(finding);

    expect(result.action).toBe('accept');
    expect(result.reason).toContain('security');
  });

  it('should suggest todo for test coverage findings', () => {
    const finding: ParsedFinding = {
      index: 0,
      agent: 'tests',
      category: 'coverage',
      priority: 'medium',
      message: 'Low coverage',
      rawText: 'raw',
    };

    const result = suggestAction(finding);

    expect(result.action).toBe('todo');
  });

  it('should suggest ignore for medium performance issues', () => {
    const finding: ParsedFinding = {
      index: 0,
      agent: 'performance',
      category: 'optimization',
      priority: 'medium',
      message: 'Could use memoization',
      rawText: 'raw',
    };

    const result = suggestAction(finding);

    expect(result.action).toBe('ignore');
  });

  it('should suggest comment for ambiguous findings', () => {
    const finding: ParsedFinding = {
      index: 0,
      agent: 'breaking',
      category: 'api-change',
      priority: 'high',
      message: 'API changed',
      rawText: 'raw',
    };

    const result = suggestAction(finding);

    expect(result.action).toBe('comment');
  });
});

describe('ACTION_REACTIONS', () => {
  it('should have reaction for all actions including merge', () => {
    expect(ACTION_REACTIONS.ignore).toBe('eyes');
    expect(ACTION_REACTIONS.accept).toBe('+1');
    expect(ACTION_REACTIONS.todo).toBe('rocket');
    expect(ACTION_REACTIONS.comment).toBe('confused');
    expect(ACTION_REACTIONS.merge).toBe('heart');
  });
});
