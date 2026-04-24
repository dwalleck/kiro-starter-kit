# Kiro Review Agents

Specialized code review configurations for the [Kiro CLI](https://kiro.dev), adapted from the [Claude Code PR Review Toolkit](https://github.com/anthropics/claude-code/tree/main/plugins/pr-review-toolkit). Use them together for broad PR coverage or individually for focused reviews.

## Prerequisites

- [Kiro CLI](https://kiro.dev) installed and configured
- Git

## Setup

Copy the `.kiro` directory into your project root:

```
cp -r path/to/kiro-starter-kit/.kiro your-project/
```

Or copy individual agent files from `.kiro/agents/` and `.kiro/agents/prompts/` if you have an existing `.kiro` directory.

## Quick Start

Switch to the orchestrator and tell it what to review:

```
/agent swap review-orchestrator
```

The orchestrator selects the right agents based on your changes, runs them in parallel, and returns an aggregated summary ranked by severity.

Each prompt should specify:
1. **Which files to review** — a git diff, a file list, staged changes, etc.
2. **Which reviewers to run** — all agents, or a specific subset

### Example Prompts

```
# All agents on uncommitted changes
Review the uncommitted changes from `git diff --name-only` with all agents

# All agents on staged changes
Review the staged files from `git diff --cached --name-only` with all agents

# All agents on a branch diff
Review the changes between this branch and main from `git diff --name-only main...HEAD` with all agents

# All agents on specific files
Review these files with all agents: src/auth/login.ts, src/utils/validation.ts

# Specific agents on specific files
Run the silent-failure-hunter and pr-test-analyzer on `git diff --name-only`
Check src/auth/login.ts with the code-reviewer
```

## Running a Single Agent

To run one agent in isolation instead of the full orchestrated review:

```
/agent swap code-reviewer
```

Then specify the files:

```
Review src/auth/login.ts and src/utils/validation.ts
```

## GitHub Action

`.github/workflows/kiro-review.yml` runs `review-orchestrator` on every PR and posts findings as inline review comments. To enable it in your project, copy `.github/` alongside `.kiro/` and then:

1. Add a `KIRO_API_KEY` secret under *Settings → Secrets and variables → Actions*.
2. Same-repo PRs run automatically on `opened` and `synchronize`. No further setup.
3. Fork PRs require a maintainer to apply the `safe-to-review` label. The label only authorizes the commit that was current when it was applied — after a new push, a maintainer must re-apply the label, so `KIRO_API_KEY` is never exposed to un-reviewed fork code.

If the orchestrator step fails, `review-output.md` and `review-stderr.log` are uploaded as the `kiro-review-debug` artifact on the workflow run page.

The Python parser that posts comments has a pytest smoke suite:

```bash
python3 -m pytest .github/scripts/test_post_review_comments.py
```

## Available Agents

| Agent | Purpose | Use When... |
|-------|---------|-------------|
| `review-orchestrator` | Coordinates all agents and aggregates results | Running a full PR review |
| `code-reviewer` | Code quality, bug detection, guideline compliance | Any code changes |
| `pr-test-analyzer` | Test coverage quality and completeness | Adding features or modifying tests |
| `silent-failure-hunter` | Silent failures, catch blocks, fallback behavior | Changing error handling code |
| `type-design-analyzer` | Type encapsulation and invariant enforcement | Adding or modifying types |
| `performance-reviewer` | Algorithmic complexity and resource management | Working with data processing, DB queries, or loops |
| `pci-compliance-reviewer` | PCI-DSS compliance (Requirements 3, 4, 6, 10) | Touching payment processing or card data |
| `comment-analyzer` | Comment accuracy and long-term maintainability | Adding or modifying documentation |
| `code-simplifier` | Code clarity and maintainability | After other reviews pass (runs last) |

## Severity Scale

All agents score issues on the same 1-100 scale:

| Score | Level | Meaning |
|-------|-------|---------|
| 80-100 | Critical | Blocks merge |
| 50-79 | Important | Should fix before merge |
| 20-49 | Suggestion | Worth fixing |
| 1-19 | Nitpick | Optional |

## Customization

Agents automatically read project-specific guidance from two locations:

- **`.kiro/steering/*.md`** — Project conventions and rules (e.g., naming conventions, import patterns, error handling policies). Create markdown files here and agents will enforce them during reviews.
- **`.kiro/skills/**/SKILL.md`** — Reusable skill definitions that agents can reference.

Agents also expect these files in your project root for additional context:
- `AGENTS.md` — Project coding guidelines
- `.editorconfig` — Formatting standards
