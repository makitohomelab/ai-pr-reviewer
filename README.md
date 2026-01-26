# AI PR Reviewer

AI-powered pull request reviewer using Claude Code on a self-hosted GitHub Actions runner. Uses your Claude Max subscription - no API costs.

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
│  │ (ubuntu)    │             └──────────────────┘              │
│  └─────────────┘                                                │
│         │ pass                                                  │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────┐       │
│  │          Self-Hosted Runner (homelab)                │       │
│  │                                                      │       │
│  │  1. Checkout code                                    │       │
│  │  2. Generate PR diff                                 │       │
│  │  3. claude --print -p "Review this PR..."           │       │
│  │  4. Post review comment                              │       │
│  └─────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

## Features

- **Uses Claude Max** - No API costs, uses your existing subscription
- **Self-Hosted Runner** - Runs on your homelab with Claude Code installed
- **Automated PR Review** - Reviews every PR after tests pass
- **Smart Skip** - Doesn't waste resources reviewing broken builds

## Setup

### 1. Create GitHub Repository

```bash
gh repo create ai-pr-reviewer --private --source=. --push
```

### 2. Setup Self-Hosted Runner

SSH to your server and run the setup script:

```bash
# SSH to your self-hosted runner machine
ssh your-user@your-server

# Install Claude Code if not already installed
npm install -g @anthropic-ai/claude-code
claude login  # Authenticate with your Claude Max account

# Download and run setup script
curl -O https://raw.githubusercontent.com/YOUR_USER/ai-pr-reviewer/main/scripts/setup-runner.sh
chmod +x setup-runner.sh
./setup-runner.sh https://github.com/YOUR_USER/ai-pr-reviewer
```

The script will:
1. Check Claude Code is installed and authenticated
2. Download GitHub Actions runner
3. Register as self-hosted runner for your repo
4. Install as a systemd service (Linux)

### 3. Verify Runner is Connected

Go to your repo → Settings → Actions → Runners

You should see `homelab-claude` with status "Idle"

### 4. Create a Test PR

```bash
git checkout -b test-review
echo "// test" >> src/index.ts
git add . && git commit -m "Test PR review"
git push -u origin test-review
gh pr create --title "Test AI Review" --body "Testing the AI reviewer"
```

## How It Works

1. **PR is opened** → GitHub Actions triggers
2. **Tests run** on ubuntu-latest (standard runner)
3. **If tests pass** → Job runs on your self-hosted runner
4. **Claude Code reviews** the PR diff using `claude --print`
5. **Comment posted** with the review

## Escalation (Manual)

For now, critical PRs are reviewed like any other. Future enhancements will add:
- Automatic escalation labels for security-sensitive files
- Human reviewer assignment for large PRs
- Confidence-based escalation

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
```

## Project Structure

```
ai-pr-reviewer/
├── .github/workflows/
│   └── pr-review.yml          # GitHub Action (self-hosted runner)
├── scripts/
│   └── setup-runner.sh        # Runner setup script
├── src/
│   ├── index.ts               # Orchestrator (for future API mode)
│   ├── agents/
│   │   └── test-quality.ts    # Test & Quality agent
│   └── lib/
│       ├── escalation.ts      # Escalation logic
│       └── github.ts          # GitHub API helpers
├── mcp-server/                # MCP server for agent memory
└── package.json
```

## Troubleshooting

### Runner not picking up jobs
```bash
# Check runner status
cd ~/actions-runner
sudo ./svc.sh status

# View logs
sudo journalctl -u actions.runner.YOUR_REPO.homelab-claude -f
```

### Claude Code not working
```bash
# Verify authentication
claude --version
claude --print -p "Hello"

# Re-authenticate if needed
claude logout
claude login
```
