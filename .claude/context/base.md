# AI PR Reviewer - Codebase Context

## Architecture

TypeScript Node.js application with provider abstraction and pipeline-based agent system.

- Entry: `src/index.ts` (orchestrator)
- Agents: `src/agents/` (BaseAgent subclasses: security, breaking, test-coverage, performance)
- Pipeline: `src/pipeline/` (sequential agent execution, result aggregation)
- Context: `src/context/` (Light-RAG context loading and delta generation)
- Providers: `src/lib/providers/` (Ollama, Anthropic)

## Critical Patterns

### Provider Abstraction
All LLM calls must go through `ModelProvider.chat(params, capability)`.
Never call Ollama/Anthropic APIs directly.

```typescript
// GOOD
const response = await provider.chat({ messages, system }, 'security');

// BAD - bypasses provider abstraction
const response = await fetch(`${OLLAMA_URL}/api/chat`, ...);
```

### Capability-Based Routing
Use `ModelCapability` to route to specialized models:
- `code-review`: General code analysis
- `security`: Security vulnerability detection
- `reasoning`: Complex multi-step reasoning
- `fast`: Quick tasks (smaller models)
- `smart`: Complex tasks (larger models)

### Structured Output
Ollama native `/api/chat` with JSON schema in `format` parameter.
Always define `RESPONSE_SCHEMA` constant per agent.

```typescript
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: { ... },
  required: ['findings', 'summary', 'confidence'],
};
```

### Agent Pipeline
Agents run sequentially: security → breaking → tests → performance.
Each agent receives findings from previous agents to avoid duplicates.

## Security-Sensitive Areas

- `src/lib/providers/` - API key handling, model configuration
- `.github/workflows/` - Secrets in env vars, self-hosted runner
- `process.env` access - May contain tokens/keys
- Agent prompts - Could be manipulated via PR content

## Anti-Patterns to Flag

1. **Direct API calls**: `fetch()` to LLM APIs bypasses provider abstraction
2. **Hardcoded models**: Use capability routing, not model names
3. **Missing try/catch**: `provider.chat()` can throw on network errors
4. **Secrets in logs**: `console.log(process.env)` may leak secrets
5. **Unbounded context**: Always apply token budget before LLM calls
