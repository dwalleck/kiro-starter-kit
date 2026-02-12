# Superpowers for Kiro

This directory contains the Superpowers skill library converted for Kiro CLI.

## What is Superpowers?

Superpowers is a complete software development workflow system built on 14 composable "skills" that guide AI assistants through proven development practices. It enforces systematic approaches to design, implementation, testing, and code review.

## Skills Included

### Design Skills
- **brainstorming** - Turn ideas into designs through Socratic dialogue
- **writing-plans** - Break designs into detailed implementation tasks

### Development Skills
- **test-driven-development** - Enforce RED-GREEN-REFACTOR cycle
- **using-git-worktrees** - Create isolated development workspaces

### Execution Skills
- **subagent-driven-development** - Fast iteration with two-stage review
- **executing-plans** - Batch execution with human checkpoints
- **dispatching-parallel-agents** - Concurrent subagent workflows

### Review Skills
- **requesting-code-review** - Pre-review checklist and review request
- **receiving-code-review** - Respond to review feedback systematically
- **finishing-a-development-branch** - Complete development workflow

### Debug Skills
- **systematic-debugging** - 4-phase root cause analysis
- **verification-before-completion** - Ensure fixes actually work

### Meta Skills
- **using-superpowers** - Introduction to the skill system
- **writing-skills** - Create new skills following best practices

## Usage

### Activate the Superpowers Agent

```bash
kiro-cli chat
/agent swap superpowers
```

Or use the keyboard shortcut: `Ctrl+Shift+S`

### Skills Load Automatically

Skills are progressively loaded - only metadata (name and description) loads at startup, with full content loaded on demand when the agent determines it's needed.

### Example Workflows

**Start a new feature:**
1. Agent automatically triggers `brainstorming` skill
2. Refines idea through questions
3. Creates design document
4. Uses `using-git-worktrees` to create isolated workspace
5. Uses `writing-plans` to break into tasks
6. Uses `subagent-driven-development` to execute with two-stage review

**Debug an issue:**
1. Agent triggers `systematic-debugging` skill
2. Follows 4-phase process: REPRODUCE → ISOLATE → IDENTIFY → VERIFY
3. Uses `verification-before-completion` to ensure fix works

**Implement with TDD:**
1. Agent enforces `test-driven-development` skill
2. Write failing test first
3. Watch it fail (if it doesn't, DELETE CODE)
4. Write minimal code to pass
5. Refactor and commit

## Core Principles

1. **Test-Driven Development** - Write tests first, always
2. **Systematic over ad-hoc** - Process over guessing
3. **Complexity reduction** - Simplicity as primary goal
4. **Evidence over claims** - Verify before declaring success
5. **YAGNI** - You Aren't Gonna Need It
6. **DRY** - Don't Repeat Yourself

## Key Concepts

### Skills Are Mandatory Workflows
When a skill's trigger condition is met, the agent MUST use that skill. They're not suggestions.

### Fresh Subagents Prevent Context Pollution
Subagent-Driven Development uses fresh subagents per task to maintain focus.

### Two-Stage Review Ensures Quality
Spec compliance review first (does it meet requirements?), then code quality review (is it well-written?).

### Git Worktrees Enable Parallel Development
Create isolated workspaces on separate branches without losing your current work.

## Tool Mappings

Superpowers skills reference generic tools that map to Kiro tools:

| Skill Reference | Kiro Tool |
|----------------|-----------|
| Read/Write/Edit | `fs_read`, `fs_write` |
| Bash | `execute_bash` |
| Task (subagents) | `use_subagent` |
| Skill | Native skill loading |

## Configuration

The Superpowers agent is configured in `.kiro/agents/superpowers.json`:

- **Model:** claude-opus-4-6
- **Skills:** All 14 skills via `skill://.kiro/skills/**/SKILL.md`
- **Resources:** AGENTS.md, README.md
- **Tools:** fs_read, fs_write, execute_bash, grep, code, use_subagent
- **Keyboard Shortcut:** Ctrl+Shift+S

## Documentation

- **AGENTS.md** - Complete reference for AI assistants
- **Skills/** - Individual skill definitions with supporting docs
- **.agents/summary/** - Detailed documentation (architecture, components, workflows, etc.)

## Original Project

Superpowers was originally created for Claude Code and is platform-agnostic.

- **Repository:** https://github.com/obra/superpowers
- **Author:** Jesse Vincent
- **License:** MIT

## Customization

### Add Personal Skills

Create your own skills in `.kiro/skills/my-skill/SKILL.md`:

```yaml
---
name: my-skill
description: When to use - what it does
---

# My Skill

## Overview
Brief description

## When to Use
Trigger conditions

## The Process
Step-by-step workflow

## Key Principles
Core concepts
```

Personal skills follow the same format and will be discovered automatically.

### Modify Existing Skills

Skills are plain markdown files. Edit them directly in `.kiro/skills/`.

## Support

For issues or questions about Superpowers:
- Original project: https://github.com/obra/superpowers/issues
- Kiro integration: https://github.com/kirodotdev/Kiro/issues
