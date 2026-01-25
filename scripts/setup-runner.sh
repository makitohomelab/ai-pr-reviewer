#!/bin/bash
# Setup GitHub Actions self-hosted runner with Claude Code
# Run this on your homelab (192.168.1.188) or mediaengine

set -e

RUNNER_DIR="$HOME/actions-runner"
REPO_URL="${1:-}"

echo "=== GitHub Actions Self-Hosted Runner Setup ==="
echo ""

# Check for Claude Code
if ! command -v claude &> /dev/null; then
    echo "❌ Claude Code not found. Install it first:"
    echo "   npm install -g @anthropic-ai/claude-code"
    echo ""
    echo "   Then authenticate:"
    echo "   claude login"
    exit 1
fi

echo "✓ Claude Code found: $(which claude)"

# Check Claude is authenticated
if ! claude --version &> /dev/null; then
    echo "❌ Claude Code not authenticated. Run: claude login"
    exit 1
fi

echo "✓ Claude Code authenticated"
echo ""

# Get repo URL if not provided
if [ -z "$REPO_URL" ]; then
    echo "Enter your GitHub repository URL (e.g., https://github.com/username/ai-pr-reviewer):"
    read REPO_URL
fi

echo ""
echo "=== Setting up runner for: $REPO_URL ==="
echo ""

# Create runner directory
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

# Detect OS and arch
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
    x86_64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
esac

echo "Detected: $OS-$ARCH"

# Download runner (get latest version)
RUNNER_VERSION=$(curl -s https://api.github.com/repos/actions/runner/releases/latest | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')
RUNNER_FILE="actions-runner-${OS}-${ARCH}-${RUNNER_VERSION}.tar.gz"
RUNNER_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_FILE}"

if [ ! -f "$RUNNER_FILE" ]; then
    echo "Downloading runner v${RUNNER_VERSION}..."
    curl -o "$RUNNER_FILE" -L "$RUNNER_URL"
    tar xzf "$RUNNER_FILE"
fi

echo ""
echo "=== Runner Configuration ==="
echo ""
echo "1. Go to your repo: $REPO_URL"
echo "2. Settings → Actions → Runners → New self-hosted runner"
echo "3. Copy the token from the configure command"
echo ""
echo "Enter the runner token:"
read RUNNER_TOKEN

# Configure the runner
./config.sh --url "$REPO_URL" --token "$RUNNER_TOKEN" --name "homelab-claude" --labels "self-hosted,claude-code" --unattended

echo ""
echo "=== Starting Runner ==="
echo ""

# Install as service (Linux) or run directly
if [ "$OS" = "linux" ]; then
    echo "Installing as systemd service..."
    sudo ./svc.sh install
    sudo ./svc.sh start
    echo "✓ Runner installed as service"
    echo ""
    echo "Commands:"
    echo "  sudo ./svc.sh status  - Check status"
    echo "  sudo ./svc.sh stop    - Stop runner"
    echo "  sudo ./svc.sh start   - Start runner"
else
    echo "Starting runner in foreground..."
    echo "To run in background: nohup ./run.sh &"
    ./run.sh
fi
