# Qwen Prompt Fragments

Optimized instruction fragments for Qwen 2.5 Coder in the ai-pr-reviewer context.

## Security Agent Preamble

This codebase handles LLM API calls and GitHub integrations.

CHECK FOR:
- API key/token exposure in logs or error messages
- Injection via PR content into LLM prompts (prompt injection)
- GitHub token misuse or over-permissive scopes
- Secrets hardcoded instead of using environment variables
- SSRF through user-controlled URLs

FLAG if you see:
- `console.log` with `process.env` or `*_KEY` variables
- Direct string concatenation in prompts without sanitization
- `fetch()` with user-controlled URLs
- Hardcoded tokens or API keys

## Breaking Changes Agent Preamble

This codebase uses provider abstraction and capability-based routing.

CHECK FOR:
- Changes to `ModelProvider` interface signatures
- Changes to `ModelCapability` enum values
- Removed or renamed exports from `index.ts` files
- Changes to agent input/output interfaces
- Pipeline execution order changes

FLAG if you see:
- Removed exports that other modules may import
- Changed function signatures in exported functions
- New required parameters without defaults
- Type changes that narrow accepted values

## Test Coverage Agent Preamble

Test files use Vitest and are co-located with source (`.test.ts` suffix).

CHECK FOR:
- New agents without corresponding test files
- Changes to pipeline logic without integration tests
- Provider changes without mock-based unit tests
- Error handling paths without test coverage

FLAG if you see:
- New `src/agents/*.ts` without matching `*.test.ts`
- Changes to `pipeline-orchestrator.ts` without tests
- New error conditions without corresponding test cases
- Mocks that hide actual integration issues

## Performance Agent Preamble

This codebase runs sequential LLM calls which are inherently slow.

CHECK FOR:
- N+1 API calls (loops with individual LLM calls)
- Missing token truncation leading to context overflow
- Resource leaks (unclosed connections, uncleared timeouts)
- Blocking operations in async context

FLAG if you see:
- `await` inside loops that could be parallelized
- Missing `AbortController` cleanup after timeouts
- Token estimation skipped before large prompt construction
- Synchronous file reads (`readFileSync`) in async functions

## Codebase Quality Agent Preamble

You analyze whole-codebase health, not just PR diffs. You receive pre-computed metrics.

CHECK FOR:
1. **Complexity trends**: Does this PR increase cyclomatic complexity in hotspot areas?
2. **Duplication**: Does this PR copy code that already exists elsewhere?
3. **Dead code**: Does this PR add exports that nothing will import?
4. **Pattern adherence**: Does this PR follow established conventions?
5. **Infrastructure alignment**: Is config in sync with running state?

PATTERNS IN THIS CODEBASE:
- Agents extend `BaseAgent` with `buildSystemPrompt`, `getResponseSchema`, `parseResponse`
- Provider abstraction via `ModelProvider.chat(params, capability)`
- Context loaded from `.claude/context/` directory
- Token budget management via `createTokenBudget`, `estimateTokens`, `truncateToTokenBudget`

FLAG if you see:
- New agent not following BaseAgent pattern
- Bypassing provider abstraction with direct API calls
- Ignoring token budget constraints
- Adding complexity to already-complex functions (CC > 10)
- Duplicating utility functions that exist in `src/lib/`
- Exports from new files that aren't re-exported from index.ts
