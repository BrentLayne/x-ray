# x-ray

A Claude Code skill that turns reviewing a GitHub PR into a guided tour.

You run `/x-ray <pr-url>`. Claude reads the whole PR, digs up the *why* behind it (PR
description, linked JIRA ticket, Slack discussion, prior PRs in the series), works out
the order the files should be read in, and pushes all of that into a **sidebar that
appears next to the diff on the GitHub PR page itself**. At the same time it kicks off
a background code review, so by the time you've finished reading and asking questions,
the findings are already sitting in the sidebar next to the file they're about.

The terminal side stays interactive: the PR is loaded into Claude's context, so you can
ask "why does this class need a lock here?" as you scroll, and get an answer grounded in
the actual diff.

## How the pieces fit together

```
Claude Code                         local broker                    Chrome
┌──────────────────┐               ┌──────────────────┐          ┌─────────────────┐
│ /x-ray <pr-url>  │  POST         │ 127.0.0.1:47821  │  poll    │ extension       │
│  ├─ reads PR     │ ────────────► │  summary +       │ ◄─────── │  renders the    │
│  ├─ gathers why  │  summary      │  findings,       │  1.5s    │  sidebar on the │
│  └─ bg review ───┼─────────────► │  keyed by PR URL │ ────────► │  PR page        │
└──────────────────┘  findings     └──────────────────┘          └─────────────────┘
```

Four moving parts:

- **`skills/x-ray/SKILL.md`** — the skill itself. Drives the whole flow: load the PR,
  gather background, build the review order, post it, spawn the background reviewer,
  then answer your questions.
- **`pr-sidebar/pr-sidebar-broker/server.js`** — a ~200-line Node HTTP server on
  `127.0.0.1:47821`. Holds summary + findings per PR URL (LRU, 50 PRs), persists to
  `~/.claude/pr-sidebar/state.json` so a Chrome restart doesn't lose your context. Bound
  to loopback with an origin allowlist (`https://github.com` + `chrome-extension://`).
- **`pr-sidebar/post-to-broker.sh`** — what the skill and the review subagent actually
  call. Handles URL-encoding, and **exits 0 even when the broker is down** so a missing
  broker degrades to a terminal-only session instead of breaking the skill.
- **`pr-sidebar/pr-sidebar-extension/`** — an unpacked MV3 Chrome extension. Content
  script mounts the sidebar on `github.com/*/pull/*` (SPA-aware, so it survives GitHub's
  client-side navigation); the service worker polls the broker rather than holding an SSE
  connection, so it survives MV3 worker suspension. Sidebar width is resizable and
  persisted. Markdown is rendered with vendored `marked` + `DOMPurify`.

## Requirements

- **macOS** for the one-command install (it uses a `launchd` LaunchAgent to keep the
  broker running). Everything else is cross-platform — on Linux/Windows just run
  `node server.js` yourself, see [Manual install](#manual-install).
- **Node** — any version with `http` and numeric separators, so Node 14+. `brew install node`
- **Chrome** (or any Chromium browser that loads unpacked MV3 extensions)
- **[Claude Code](https://claude.com/claude-code)**
- **`gh`** — the skill fetches the PR with the GitHub CLI. `brew install gh && gh auth login`
- **`python3`** — `post-to-broker.sh` uses it to URL-encode the PR URL. Preinstalled on macOS.
- **The `code-review` plugin** — the background reviewer runs `/code-review medium`:
  ```
  /plugin marketplace add anthropics/claude-plugins-official
  /plugin install code-review
  ```

## Install

```bash
git clone https://github.com/BrentLayne/x-ray.git ~/workspace/x-ray
cd ~/workspace/x-ray
./install.sh
```

`install.sh` symlinks (doesn't copy) into `~/.claude`, so `git pull` in this repo updates
your install with nothing to re-run:

| Repo file | Symlinked to |
| --- | --- |
| `skills/x-ray/SKILL.md` | `~/.claude/skills/x-ray/SKILL.md` |
| `pr-sidebar/post-to-broker.sh` | `~/.claude/pr-sidebar/post-to-broker.sh` |
| `pr-sidebar/pr-sidebar-broker/server.js` | `~/.claude/pr-sidebar/pr-sidebar-broker/server.js` |

It also renders `com.x-ray.pr-sidebar.plist` with your Node path, copies it to
`~/Library/LaunchAgents/`, and `kickstart`s it. (The plist can't be a symlink —
modern `launchd` refuses to follow symlinks in `~/Library/LaunchAgents`.)

Then the two steps a script can't do for you:

**1. Load the Chrome extension** (one-time)

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top right)
3. Click **Load unpacked** and choose `pr-sidebar/pr-sidebar-extension`

Keep Developer mode on — Chrome disables unpacked extensions without it.

**2. Verify the broker is up**

```bash
curl http://127.0.0.1:47821/health
# {"ok":true,"prs":0}
```

## Usage

Open the PR in Chrome, then in Claude Code:

```
/x-ray https://github.com/owner/repo/pull/1234
```

Claude will:

1. Fetch and read the full PR and its description.
2. Gather background — JIRA ticket, Slack thread where the author asked for review,
   prior PRs in the series.
3. Post a **PR background** blurb and a **file-by-file review order** to the sidebar,
   each file annotated with why it's at that position, what it builds on, and what it
   sets up for.
4. Spawn a background subagent running `/code-review medium`, whose findings stream into
   the sidebar as they land — tagged `critical` / `other` / `general`, and clickable to
   jump to the file.
5. Answer your questions about the diff while you read.

The background reviewer is explicitly forbidden from posting anything to GitHub — no
`gh pr comment`, no `gh pr review`. Findings are local-only, for your eyes.

When you're out of questions, ask Claude to walk you through the findings together.

The sidebar mounts on GitHub PR pages and shows "Waiting for /x-ray…" until a payload
for that exact PR URL arrives. Data is keyed by PR URL, so you can have several PRs
x-rayed at once and each tab shows its own.

## Notes and caveats

- **The JIRA and Slack lookups are opportunistic.** The skill reaches for them through
  whatever MCP servers you happen to have connected. With none connected, it falls back
  to the PR description and commit history — the skill is instructed to skip unreachable
  signals silently rather than invent motivation. If you want that context, connect a
  JIRA and/or Slack MCP server first.
- **`disable-model-invocation: true`** is set on the skill, so Claude won't decide to
  x-ray something on its own. It only runs when you type `/x-ray`.
- **Only one broker can run at a time**, since it binds a fixed port. `install.sh` boots
  out any existing `com.x-ray.pr-sidebar` agent before loading the new one, so re-running
  it is safe. If you have a broker running under some other label, stop it first —
  otherwise the second one loses the race for 47821 and crash-loops.
- **Port 47821 is hardcoded** in four places: `server.js`, `post-to-broker.sh`,
  `background.js`, and `manifest.json`'s `host_permissions`. Change all four if it
  collides with something.
- **The broker keeps the last 50 PRs** and nothing is ever sent off your machine.

## Manual install

If you're not on macOS, or you'd rather not have a LaunchAgent:

```bash
# 1. Put the skill where Claude Code finds it
mkdir -p ~/.claude/skills/x-ray
ln -s "$PWD/skills/x-ray/SKILL.md" ~/.claude/skills/x-ray/SKILL.md

# 2. Put the broker helper where SKILL.md expects it (this path is hardcoded in the skill)
mkdir -p ~/.claude/pr-sidebar/pr-sidebar-broker
ln -s "$PWD/pr-sidebar/post-to-broker.sh" ~/.claude/pr-sidebar/post-to-broker.sh
ln -s "$PWD/pr-sidebar/pr-sidebar-broker/server.js" ~/.claude/pr-sidebar/pr-sidebar-broker/server.js

# 3. Run the broker however you like — foreground, tmux, systemd --user, pm2
node ~/.claude/pr-sidebar/pr-sidebar-broker/server.js
```

Then load the unpacked extension as above.

## Troubleshooting

**Sidebar stuck on "Waiting for /x-ray…"**
The broker has no data for that URL yet, or the URL doesn't match. The key is the exact
PR URL string you passed to `/x-ray` — so `.../pull/1234` and `.../pull/1234/files` are
different keys. Check what the broker actually holds:
```bash
curl "http://127.0.0.1:47821/pr/$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' 'https://github.com/owner/repo/pull/1234')"
```

**Sidebar says the broker is offline**
```bash
curl http://127.0.0.1:47821/health          # should print {"ok":true,...}
tail -50 /tmp/pr-sidebar-broker.log         # broker stdout + stderr
launchctl print "gui/$UID/com.x-ray.pr-sidebar" | head -20
launchctl kickstart -k "gui/$UID/com.x-ray.pr-sidebar"   # force a restart
```
`EADDRINUSE` in the log means something else already owns 47821: `lsof -i :47821`.

**Claude says "broker not reachable" but keeps going**
Working as designed — `post-to-broker.sh` always exits 0 so a dead broker can't break the
skill. Fix the broker and re-run `/x-ray` to repopulate the sidebar.

**No sidebar at all on the PR page**
Confirm the extension is enabled at `chrome://extensions` and Developer mode is still on.
The content script only matches `https://github.com/*/pull/*`. Check the page console for
content-script errors and the extension's service worker console for fetch errors.

**`/x-ray` isn't offered in Claude Code**
Check `~/.claude/skills/x-ray/SKILL.md` resolves (`ls -l`) and restart Claude Code —
skills are read at startup.

## Uninstall

```bash
launchctl bootout "gui/$UID/com.x-ray.pr-sidebar"
rm -f ~/Library/LaunchAgents/com.x-ray.pr-sidebar.plist
rm -rf ~/.claude/skills/x-ray ~/.claude/pr-sidebar
```

Then remove the extension at `chrome://extensions`.

## Vendored dependencies

`pr-sidebar-extension/vendor/` contains [marked](https://github.com/markedjs/marked) and
[DOMPurify](https://github.com/cure53/DOMPurify), vendored rather than bundled so the
extension has no build step — Chrome loads the directory as-is. The skill's `why`,
`rationale`, and finding fields are authored as GitHub-Flavored Markdown and rendered
through `marked`, then sanitized with `DOMPurify` before being inserted into the page.
