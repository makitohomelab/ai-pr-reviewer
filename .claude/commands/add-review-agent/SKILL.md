# Add Review Agent

Scaffold a new specialized review agent for the AI PR Reviewer pipeline.

## Usage

```
/add-review-agent <agent-name>
```

Example: `/add-review-agent documentation` creates a DocumentationAgent.

## What This Creates

1. `src/agents/<name>-agent.ts` - Agent implementation extending BaseAgent
2. Updates `src/agents/index.ts` - Export the new agent
3. Updates `src/pipeline/pipeline-orchestrator.ts` - Add to default agents
4. Updates `.claude/context/qwen-prompts.md` - Add preamble section

## Agent Template Structure

```typescript
import { BaseAgent } from './base-agent.js';
import { AgentCapability } from './types.js';

export class <Name>Agent extends BaseAgent {
  readonly name = '<name>';
  readonly capability: AgentCapability = '<name>-review';
  readonly priority = 50; // 1-100, higher = runs first

  protected buildSystemPrompt(repoContext: string): string {
    return `You are a specialized <name> reviewer...`;
  }

  protected getResponseSchema() {
    return { /* JSON schema for structured output */ };
  }
}
```

## Implementation Steps

1. **Ask for focus area**: What should this agent review? (security, docs, style, etc.)
2. **Generate agent file**: Create `src/agents/<name>-agent.ts` with appropriate:
   - System prompt focused on the review area
   - Response schema for findings
   - Priority relative to other agents
3. **Update exports**: Add to `src/agents/index.ts`
4. **Add to pipeline**: Update `pipeline-orchestrator.ts` default agents
5. **Add preamble**: Create section in `qwen-prompts.md` for repo-specific guidance

## After Creation

1. Customize the system prompt for your specific review focus
2. Add repo-specific patterns to the qwen-prompts.md preamble
3. Test locally: `pnpm build && node dist/index.js --pr <test-pr>`
4. Commit and push to trigger the full pipeline

## Example Agents to Consider

- **DocumentationAgent** - Check for missing/outdated docs
- **TypeSafetyAgent** - Strict TypeScript patterns
- **ErrorHandlingAgent** - Proper error handling patterns
- **AccessibilityAgent** - A11y in UI code
- **DependencyAgent** - Review package changes
