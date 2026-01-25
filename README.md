# AI PR Reviewer

AI-powered pull request reviewer with specialized subagents for automated code review.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub Actions                           │
├─────────────────────────────────────────────────────────────────┤
│  PR Opened/Updated                                              │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────┐     fail    ┌──────────────────┐              │
│  │  Run Tests  │────────────►│ Skip AI Review   │              │
│  └─────────────┘             └──────────────────┘              │
│         │ pass                                                  │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────┐       │
│  │              Orchestrator (Haiku)                    │       │
│  │  - Fetches PR diff, files changed                   │       │
│  │  - Checks escalation criteria                        │       │
│  │  - Routes to subagents                               │       │
│  └─────────────────────────────────────────────────────┘       │
│         │                          │                            │
│         ▼                          ▼ (if critical)              │
│  ┌─────────────────┐      ┌─────────────────────────┐          │
│  │ Test & Quality  │      │  Request Human Review   │          │
│  │    Agent        │      │  (add label, mention)   │          │
│  │   (Haiku)       │      └─────────────────────────┘          │
│  └─────────────────┘                                            │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────┐       │
│  │  Post PR Comment (inline + summary)                  │       │
│  └─────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

## Features

- **Automated PR Review**: Reviews pull requests using Claude AI
- **Test & Quality Agent**: Analyzes code for test coverage and quality issues
- **Smart Escalation**: Automatically flags critical PRs for human review
- **Cost Efficient**: Uses Claude Haiku for most operations
- **Persistent Memory**: MCP server stores learned patterns across reviews

## Escalation Criteria

PRs are escalated for human review when:
- **Critical files** are modified (security/, .env, migrations/, workflows/)
- **Large PRs**: >500 lines changed or >20 files
- **Low confidence**: Agent confidence below 70%

## Setup

### 1. Configure GitHub Secrets

Add these secrets to your repository:
- `ANTHROPIC_API_KEY`: Your Anthropic API key

### 2. Enable the Workflow

The workflow in `.github/workflows/pr-review.yml` will automatically run on PRs.

### 3. (Optional) Deploy MCP Server

For persistent memory across reviews, deploy the MCP server to your homelab:

```bash
cd mcp-server
npm install
npm run build
docker-compose up -d
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Type check
npm run typecheck
```

## Project Structure

```
ai-pr-reviewer/
├── .github/workflows/
│   └── pr-review.yml          # GitHub Action workflow
├── src/
│   ├── index.ts               # Main orchestrator
│   ├── agents/
│   │   └── test-quality.ts    # Test & Quality agent
│   └── lib/
│       ├── escalation.ts      # Escalation logic
│       └── github.ts          # GitHub API helpers
├── mcp-server/                # MCP server for agent memory
│   ├── src/
│   │   ├── index.ts           # Server entry point
│   │   ├── server.ts          # MCP tools definition
│   │   └── db.ts              # SQLite persistence
│   ├── Dockerfile
│   └── docker-compose.yml
└── package.json
```

## Future Enhancements

- [ ] Architecture Vision agent
- [ ] Documentation agent
- [ ] Local LLM support (Ollama)
- [ ] Team-based review workflows
- [ ] Token budget management
