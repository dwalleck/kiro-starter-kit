# code-review-max

A max-effort, recall-mode code review that runs as a **Kiro workflow** (kiro-cli 2.26.0+, KAS engine) on
**native Windows, with no Python installed**.

- Eight finder angles review the diff in parallel: line scan, removed behavior, cross-file callers,
  language pitfalls, wrapper/proxy correctness, cleanup, altitude, and rules-file conventions.
- Every candidate finding is verified in its own fresh session.
- A gap sweep then looks for anything the first pass missed.
- Unstable verdicts get two more independent votes:
  - every first-round REFUTED;
  - every conventions claim.
- The findings are ranked. The top 15 come out as a report and as postable review comments in the
  [Conventional Comments](https://conventionalcomments.org) format.

The model steps only make judgment calls. Every mechanical step runs in `crtool.mjs`, a dependency-free
Node script: merging candidates, sharding the verification queues, tallying votes, rendering the report.
No model ever retypes another model's text, and every file a model reads fits in one tool call.

## Why Node, and which Node

kiro-cli runs its KAS engine on a `node` binary it unpacks into its own data directory. On Windows that is
`%LOCALAPPDATA%\Kiro-Cli\node.exe` (Node 22). Workflows only run on KAS, so that runtime exists on every
machine where this workflow can run. The recipe calls it by that path in PowerShell's call form:

```powershell
& "$env:LOCALAPPDATA\Kiro-Cli\node.exe" .kiro/code-review/crtool.mjs <subcommand> ...
```

`node.exe` is only unpacked the **first time KAS starts**. A fresh install has just `kiro-cli.exe`. Start
`kiro-cli chat --v3` once before the first review.

## Contents

| Path | Installs to | What |
| --- | --- | --- |
| `workflows/code-review-max-windows.workflow.json` | `.kiro/workflows/` | The recipe (20 step nodes) |
| `code-review/crtool.mjs` | `.kiro/code-review/` | Deterministic data steps: `gather facts merge shard ballots collate finalize comments` |
| `agents/cr-finder.md` | `.kiro/agents/` | Reviews the diff from one assigned angle |
| `agents/cr-verifier.md` | `.kiro/agents/` | Confirms or refutes one candidate per session |
| `agents/cr-clerk.md` | `.kiro/agents/` | Runs crtool; decides which candidates are duplicates; ranks the findings |
| `agents/cr-commenter.md` | `.kiro/agents/` | Writes one Conventional Comment per reported finding |

The recipe expects `crtool.mjs` at exactly `.kiro/code-review/crtool.mjs`, relative to the workspace root.

## Install

From the root of the repository you want reviewed (PowerShell):

```powershell
$plugin = "path\to\kiro-starter-kit\plugins\code-review-max"
New-Item -ItemType Directory -Force .kiro\agents, .kiro\workflows, .kiro\code-review | Out-Null
Copy-Item "$plugin\agents\*.md" .kiro\agents\
Copy-Item "$plugin\workflows\code-review-max-windows.workflow.json" .kiro\workflows\
Copy-Item "$plugin\code-review\crtool.mjs" .kiro\code-review\
Add-Content .gitignore ".code-review/"
```

The `.workflow.json` suffix is required: the loader rejects a plain `.json` file in `.kiro/workflows/`.
`git` must be on `PATH`, because crtool runs `git diff` and `git grep`.

## Enable workflows

1. `kiro-cli chat --v3`
2. `/settings` → **Features** → enable **Workflows** (stored as `chat.enableWorkflows`)
3. Restart kiro-cli. Workflow commands are fixed when the process starts.

## Run

`/workflow run`, pick `code-review-max-windows`, and give the inputs:

| Input | Example | Notes |
| --- | --- | --- |
| `rundir` | `C:/src/myrepo/.code-review/20261002-1530` | Fresh, **absolute**, inside the workspace, written with forward slashes. No quotes, backticks or `$`. |
| `target` | `main...HEAD`, `HEAD`, a commit, or `auto` | `auto` picks upstream/main/master and includes uncommitted changes when there are any. |
| `scope` | `.` or `src tests` | Space-separated git pathspecs. |
| `context` | `Spec: docs/design/caching.md` | Documents that are authoritative for this change. Verifiers consult them before confirming a finding. |

Every crtool call is a shell command, so kiro-cli asks for approval each time unless you trust it. For an
unattended run, allow commands that start with `& "$env:LOCALAPPDATA\Kiro-Cli\node.exe" .kiro/code-review/crtool.mjs`.

Follow the run with `/workflow`. In that view, `p` pauses, `r` resumes or retries, `s` steers or replies
to a step, and Ctrl+X twice stops it. `/workflow retry <id>` re-runs only the failed steps.

## Results

In `<rundir>`:

- `report.md`: summary table, every finding with evidence, refuted candidates, run warnings, and the
  review comments
- `findings.json`: the top 15, most severe first, each with its comment
- `comments.json` / `comments.md`: one postable comment per reported finding, with file, line and body

Every intermediate file stays in the run directory too: candidates, dedup decisions, queues, verdicts and
ballots.

## Models

Steps pin `claude-opus-5` (finders, sweep) and `claude-sonnet-5` (verifiers, clerk, commenter). An unknown
`modelId` fails its step at runtime with no fallback. If your account lacks one of these models, edit the
`modelId` fields in the recipe and the `model:` lines in the agent files.

## Origin

Ported from the cyril repository's `code-review-max` experiment. There, `crtool.py` (Python) is the
reference implementation and `build_recipe.py --windows` generates this recipe. `crtool.mjs` follows
`crtool.py` output for output, except that JSON parse-error messages use Node's wording. Its `diagnostics`
subcommand isn't ported, because the recipe never calls it.
