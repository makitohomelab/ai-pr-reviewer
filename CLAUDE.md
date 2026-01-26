# AI PR Reviewer

## Overview

An automated PR review system using specialized AI agents. This repo IS the AI PR reviewer - working here involves meta-programming.

## Cross-Model Collaboration

```
Sonnet/Opus (you) → writes code → PR opened → Qwen agents review → Sonnet responds → learnings sync
```

- **Sonnet/Opus** (you): Write code, respond to reviews
- **Qwen agents**: Review PRs via GitHub Actions pipeline
- **Feedback loop**: Learnings sync to repo-manager MCP

## Key Skills

- `/generate-qwen-context` - Regenerate context after major changes
- `/add-review-agent` - Scaffold a new specialized agent
- `/respond-to-review` - Read and respond to Qwen's review

## Architecture

### Agent System

Agents extend `BaseAgent` in `src/agents/`. Each agent:
1. Has a focused capability (security, performance, breaking-changes, test-coverage)
2. Defines its own system prompt and response schema
3. Runs in the pipeline with accumulated findings

Current agents:
- `SecurityAgent` - Vulnerability detection
- `BreakingChangesAgent` - API compatibility
- `TestCoverageAgent` - Test gap analysis
- `PerformanceAgent` - Performance impact review

### Context System (Light-RAG)

Context files in `.claude/context/` are loaded at review time:
- `base.md` - Human-readable patterns and decisions
- `patterns.json` - Structured matching rules for file types
- `qwen-prompts.md` - Agent preambles and guidelines

Regenerate after major architecture changes with `/generate-qwen-context`.

### Provider Abstraction

All LLM calls go through `ModelProvider.chat(params, capability)`:
- Capability-based routing (fast, balanced, capable, premium)
- Provider abstraction (OpenRouter, local Ollama, etc.)
- Token budget management

## Adding New Agents

1. Create `src/agents/<name>-agent.ts` extending `BaseAgent`
2. Export from `src/agents/index.ts`
3. Add to pipeline in `src/pipeline/pipeline-orchestrator.ts`
4. Add preamble section to `.claude/context/qwen-prompts.md`

Or use `/add-review-agent <name>` to scaffold automatically.

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # Compile TypeScript
pnpm test             # Run tests

# Local testing
node dist/index.js --pr 3 --repo owner/repo
```

## File Structure

```
src/
├── agents/           # Specialized review agents
├── context/          # Light-RAG context system
├── pipeline/         # Orchestration and aggregation
├── providers/        # LLM provider abstraction
└── lib/              # Shared utilities

.claude/
├── context/          # Review context files
│   ├── base.md       # Human-readable patterns
│   ├── patterns.json # Structured matching rules
│   └── qwen-prompts.md # Agent preambles
└── commands/         # Skills for this repo
