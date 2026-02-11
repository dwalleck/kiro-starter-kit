# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **configuration-only repository** (no application source code) containing pre-built Kiro CLI agent configurations for an orchestrated PR code review system. All content is JSON configs + Markdown prompts.

## Architecture

**Orchestrator-Worker pattern**: The `review-orchestrator` receives review requests, determines scope via git commands, selects applicable worker agents, invokes them in parallel (batches of up to 4), and aggregates results into a severity-ranked summary.

- Only the orchestrator has the `use_subagent` tool
- All 8 workers share the same tool set: `fs_read`, `execute_bash`, `grep`, `code`, `glob`
- `code-simplifier` always runs last as a final polish step
- All agents use `claude-opus-4-6`

## Key Directories

- `.kiro/agents/*.json` — Agent configuration files (JSON Schema validated against `agent-schema.json`)
- `.kiro/agents/prompts/*.md` — System prompts for each agent (referenced via `file://` in configs)
- `.kiro/settings/lsp.json` — LSP server configuration for the `code` tool
- `.agents/summary/` — Auto-generated documentation summaries

## Agent Configuration Format

Configs conform to `agent-schema.json`. Only `name` is required. Key fields:

```json
{
  "$schema": "../../agent-schema.json",
  "name": "agent-name",
  "prompt": "file://./prompts/agent-name.md",
  "model": "claude-opus-4-6",
  "tools": ["fs_read", "execute_bash", "grep", "code", "glob"],
  "allowedTools": ["fs_read", "execute_bash", "grep", "code", "glob"],
  "resources": ["file://AGENTS.md", "file://.editorconfig", "file://.kiro/steering/*.md"]
}
```

Resources use `file://` paths relative to the project root. Agents also support `skill://` resource paths for Kiro skills.

## Adding a New Agent

1. Create `.kiro/agents/prompts/<name>.md` — system prompt defining expertise and output format
2. Create `.kiro/agents/<name>.json` — config referencing the prompt, model, tools, and resources
3. Add agent name to both `availableAgents` and `trustedAgents` arrays in `review-orchestrator.json` → `toolsSettings.subagent`
4. Update `review-orchestrator.md` prompt with selection criteria for the new agent

## Conventions

- All agents use a consistent **1-100 severity scale**: Critical (80-100), Important (50-79), Suggestion (20-49), Nitpick (1-19)
- Agents read project-specific guidance from `.kiro/steering/*.md` and `.kiro/skills/**/SKILL.md` in the target project
- Agent prompts instruct reviewers to only report issues with severity >= 20
- The orchestrator aggregates findings into a unified markdown summary grouped by severity

## Dependencies

- **Kiro CLI** — Runtime that loads and executes agent configurations
- **Git** — Used for scope determination (`git diff`, `git status`, `git log`)
- **GitHub CLI (`gh`)** — Optional, for PR metadata retrieval
