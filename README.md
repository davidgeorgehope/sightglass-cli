# 🔍 Sightglass CLI

**Agent supply chain intelligence** — see what your AI coding agents actually decide.

Your AI coding agent just added 47 dependencies to your project. Do you know why it picked any of them?

## Quick Start

```bash
npx @sightglass/cli setup
```

Detects your agents, creates an account, starts the watcher daemon.

## What It Does

When an AI agent installs a dependency, Sightglass classifies **how** it made that decision:

| Classification | Meaning |
|---|---|
| **Training Recall** | Agent "just knew" from training data — no search |
| **Context Inheritance** | Found in existing project files |
| **Reactive Search** | Hit a problem, searched for solution |
| **Proactive Search** | Actively compared alternatives |
| **User Directed** | Human specified what to use |

High training recall = your agent is on autopilot, not thinking.

## Supported Agents

- ✅ Claude Code
- ✅ Codex CLI
- 🔜 Cursor
- 🔜 Windsurf
- 🔜 GitHub Copilot

## Commands

```bash
sightglass setup     # One-command setup (detect agents, login, start daemon)
sightglass login     # Authenticate with sightglass.dev
sightglass watch     # Watch agent sessions in real-time
sightglass analyze   # Analyze collected sessions
sightglass init      # Initialize in current project
```

## Dashboard

View your agent intelligence at [sightglass.dev](https://sightglass.dev)

## License

MIT
