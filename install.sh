#!/bin/bash

# Installs the x-ray skill and its PR sidebar broker into ~/.claude.
#
# What this does:
#   - symlinks skills/x-ray/SKILL.md    -> ~/.claude/skills/x-ray/SKILL.md
#   - symlinks pr-sidebar/*             -> ~/.claude/pr-sidebar/*
#   - installs + starts a LaunchAgent that runs the broker on 127.0.0.1:47821
#
# Symlinks mean `git pull` in this repo updates your install with no re-run.
# Loading the Chrome extension is a manual one-time step, printed at the end.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🩻 x-ray installer"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Symlink source -> target, backing up a real file already at the target.
link_file() {
    local source="$1"
    local target="$2"

    if [ -e "$target" ] && [ ! -L "$target" ]; then
        echo "  📦 Backing up existing $target to ${target}.bak"
        mv "$target" "${target}.bak"
    fi

    if [ -L "$target" ]; then
        rm "$target"
    fi

    echo "  🔗 $target"
    ln -s "$source" "$target"
}

echo "🎯 Linking the x-ray skill..."
mkdir -p "$CLAUDE_DIR/skills/x-ray"
link_file "$SCRIPT_DIR/skills/x-ray/SKILL.md" "$CLAUDE_DIR/skills/x-ray/SKILL.md"
echo ""

echo "🧭 Linking the PR sidebar broker..."
mkdir -p "$CLAUDE_DIR/pr-sidebar/pr-sidebar-broker"
chmod +x "$SCRIPT_DIR/pr-sidebar/post-to-broker.sh"
link_file "$SCRIPT_DIR/pr-sidebar/post-to-broker.sh" "$CLAUDE_DIR/pr-sidebar/post-to-broker.sh"
link_file "$SCRIPT_DIR/pr-sidebar/pr-sidebar-broker/server.js" "$CLAUDE_DIR/pr-sidebar/pr-sidebar-broker/server.js"
echo ""

BROKER_STARTED=false
echo "🚀 Starting the broker..."
if [ "$(uname)" != "Darwin" ]; then
    echo "  ⚠️  Not macOS — skipping LaunchAgent setup."
    echo "     Run the broker yourself: node $CLAUDE_DIR/pr-sidebar/pr-sidebar-broker/server.js"
else
    NODE_BIN="$(command -v node)"
    if [ -z "$NODE_BIN" ]; then
        echo "  ⚠️  node not found on PATH — skipping LaunchAgent setup."
        echo "     Install Node (brew install node) and re-run ./install.sh."
    else
        PLIST_SOURCE="$SCRIPT_DIR/pr-sidebar/pr-sidebar-broker/com.x-ray.pr-sidebar.plist"
        PLIST_TARGET="$HOME/Library/LaunchAgents/com.x-ray.pr-sidebar.plist"
        SERVER_PATH="$CLAUDE_DIR/pr-sidebar/pr-sidebar-broker/server.js"

        # launchd on modern macOS does not follow symlinks in ~/Library/LaunchAgents,
        # and silently ignores RunAtLoad on `bootstrap` — so render + copy + kickstart.
        mkdir -p "$HOME/Library/LaunchAgents"
        launchctl bootout "gui/$UID/com.x-ray.pr-sidebar" 2>/dev/null || true
        rm -f "$PLIST_TARGET"
        sed -e "s|__NODE_BIN__|$NODE_BIN|g" -e "s|__SERVER_PATH__|$SERVER_PATH|g" \
            "$PLIST_SOURCE" > "$PLIST_TARGET"
        launchctl bootstrap "gui/$UID" "$PLIST_TARGET"
        launchctl kickstart -p "gui/$UID/com.x-ray.pr-sidebar" >/dev/null
        BROKER_STARTED=true
        echo "  ✅ LaunchAgent loaded — broker on http://127.0.0.1:47821"
        echo "     Logs: /tmp/pr-sidebar-broker.log"
    fi
fi
echo ""

if [ "$BROKER_STARTED" = true ]; then
    echo "🩺 Health check..."
    HEALTH=""
    for _ in 1 2 3 4 5; do
        HEALTH="$(curl -sS -f http://127.0.0.1:47821/health 2>/dev/null || true)"
        [ -n "$HEALTH" ] && break
        sleep 1
    done
    if [ -n "$HEALTH" ]; then
        echo "  ✅ $HEALTH"
    else
        echo "  ⚠️  Broker did not answer on 127.0.0.1:47821."
        echo "     Check /tmp/pr-sidebar-broker.log — port 47821 may already be in use."
    fi
    echo ""
fi

echo "🔍 Checking dependencies..."
if command -v gh >/dev/null 2>&1; then
    echo "  ✓ gh (GitHub CLI)"
else
    echo "  ⚠️  gh not found — x-ray uses it to fetch PRs. Install: brew install gh"
fi
if command -v python3 >/dev/null 2>&1; then
    echo "  ✓ python3 (used by post-to-broker.sh for URL encoding)"
else
    echo "  ⚠️  python3 not found — post-to-broker.sh needs it to URL-encode PR URLs."
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧩 Remaining manual steps"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  1. Load the Chrome extension (one-time):"
echo "       a. Open chrome://extensions"
echo "       b. Toggle 'Developer mode' on (top right)"
echo "       c. Click 'Load unpacked' and choose:"
echo "          $SCRIPT_DIR/pr-sidebar/pr-sidebar-extension"
echo ""
echo "  2. Install the code-review plugin, which /x-ray's background review uses:"
echo "       /plugin marketplace add anthropics/claude-plugins-official"
echo "       /plugin install code-review"
echo ""
echo "  3. Open a GitHub PR in Chrome, then in Claude Code run:"
echo "       /x-ray <pr-url>"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
