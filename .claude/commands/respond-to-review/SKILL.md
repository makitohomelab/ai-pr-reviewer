# Respond to Review

Read Qwen's PR review and respond as Sonnet/Opus.

## Usage

```
/respond-to-review <pr-number>
```

Example: `/respond-to-review 3`

## Response Actions

| Action | Emoji | Meaning |
|--------|-------|---------|
| `ignore` | 👀 | Acknowledged, no action needed |
| `accept` | 👍 | Will fix / already fixed |
| `todo` | 🚀 | Deferred to backlog |
| `comment` | 😕 | Need discussion/clarification |
| `merge` | ❤️ | Approved & merged |

## Workflow

### Phase 1: Fetch Review

```bash
gh pr view <pr-number> --comments --json number,comments,title,body
```

Look for the AI Review comment containing findings like:
- 🔴 **[security/injection]** Critical finding
- 🟠 **[breaking/api-change]** High priority finding
- 🟡 **[tests/coverage]** Medium priority finding

### Phase 2: Analyze Findings

For each finding:

1. **Read the referenced code** (file:line)
2. **Evaluate validity** - Is this a real issue?
3. **Decide action**: ignore | accept | todo | comment

Use `src/lib/review-response.ts`:
- `parseReviewFindings(body)` - Extract findings from comment
- `suggestAction(finding)` - Get suggested action based on priority/type
- `canMerge(responses)` - Check if merge is allowed

### Phase 3: Execute Responses

For each finding with a decided action:

1. **Add emoji reaction** to the review comment (matches action)
2. **Post reply** if comment provided or action is accept/todo

```typescript
// From src/lib/response-executor.ts
executeResponses(octokit, context, session)
```

### Phase 4: Post Summary

Post a summary comment grouping responses by action:

```markdown
## Response to AI Review

### Accepted (Will Fix)
- **[security/injection]** SQL injection risk in query builder
  > Fixed in abc1234

### Deferred (TODO)
- **[tests/coverage]** Missing unit tests for edge cases
  > Will add in follow-up PR

### Acknowledged (No Action)
- **[performance/optimization]** Could use memoization
  > Premature optimization; current perf is acceptable

---
**Summary:** 2 accepted, 1 deferred, 0 discussing, 1 acknowledged
```

### Phase 5: Merge (Optional)

If user requests merge:

1. **Guard check**: Block if any critical finding not accepted
   ```typescript
   canMerge(responses) // Returns {allowed, reason}
   ```

2. **Merge status check**: Verify PR is mergeable on GitHub

3. **Approve PR**: Post approval review

4. **Squash merge** (default method)

5. **Add ❤️ reaction** to review comment

```typescript
// From src/lib/response-executor.ts
executeMerge(octokit, context, responses, { method: 'squash', deleteBranch: true })
```

### Phase 6: Sync to repo-manager MCP

Log the session to repo-manager for learning:

```typescript
// Prepare data
const { learnings, decision, review } = prepareMCPSync(session, mergeResult)
```

Then call MCP tools:

| Action | MCP Tool | When |
|--------|----------|------|
| Accepted patterns | `mcp__repo-manager__reinforce_learning` | For each accepted finding |
| Merge decision | `mcp__repo-manager__log_decision` | If PR was merged |
| Session summary | `mcp__repo-manager__log_review` | Always |

## Implementation Details

### Key Files

- `src/lib/review-response.ts` - Finding parser, response types, formatters
- `src/lib/github.ts` - GitHub API: reactions, comments, merge
- `src/lib/response-executor.ts` - Orchestration: executeResponses, executeMerge, prepareMCPSync

### Response Protocol

For each finding, output your analysis:

```markdown
**Finding #1:** 🔴 [security/injection] SQL query uses string concatenation
**File:** src/db/query.ts:42
**Analysis:** Valid finding - using template literals for SQL is unsafe
**Action:** accept
**Comment:** Fixed by switching to parameterized queries
```

Then execute the action.

## Example Session

```
User: /respond-to-review 5

Claude: I'll review the AI findings on PR #5.

[Fetches PR comments via gh CLI]
[Parses 3 findings from AI Review comment]

**Finding #1:** 🔴 [security/injection] Unsafe user input in SQL query
**File:** src/api/users.ts:87
**Analysis:** Valid - using string interpolation in SQL is dangerous
**Action:** accept
**Response:** Will fix with parameterized query

**Finding #2:** 🟠 [breaking/api-change] Removed required field from response
**File:** src/api/users.ts:45
**Analysis:** False positive - field was deprecated and unused
**Action:** ignore
**Response:** Field was marked deprecated in v2.0, no consumers

**Finding #3:** 🟡 [tests/coverage] Missing tests for error handling
**File:** src/api/users.ts
**Analysis:** Valid but non-blocking
**Action:** todo
**Response:** Will add in follow-up PR #6

[Posts reactions to review comment]
[Posts summary comment]

Summary: 1 accepted, 1 deferred, 0 discussing, 1 acknowledged

User: looks good, merge it

Claude: [Checks merge guard - no unaddressed critical findings]
[Approves PR]
[Squash merges]
[Syncs learnings to repo-manager]

Merged PR #5 (sha: def4567). Logged 1 learning pattern to repo-manager.
```
