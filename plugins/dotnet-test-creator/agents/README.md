# Kiro test-generation agents (merged best-of-both)

A Kiro port of the Copilot `dotnet-test` test-generation flow. Copilot allows nested
sub-agents (generator → implementer → builder/tester/fixer/linter); Kiro does not
(subagents cannot spawn subagents). The flow is therefore **flattened**, and coverage
iteration is offered in two forms.

```
code-testing-generator   (you run this; the only agent with the crew/subagent tool)
 ├─ code-testing-researcher  → .testagent/research.md
 ├─ code-testing-planner     → .testagent/plan.md
 ├─ code-testing-implementer → writes tests AND builds/tests/fixes/lints itself (loops all phases)
 └─ code-testing-validator   → full build/test + coverage-gap audit; drives the loop (loop variant only)
```

Two structural facts that shape everything:
- The **implementer absorbs** builder/tester/fixer/linter and runs build/test inline.
- There is **one `implement` stage that loops all phases internally** — the planner decides
  phase count at runtime, so a static DAG can't enumerate phases.

## Two iteration variants

| Variant | Payload | How coverage iteration works |
|---|---|---|
| **Manual** | `crew-dag.json` (3 stages) | Generator runs final validation in its own turns and re-submits a narrowed crew pass for remaining gaps (`research-2.md`/`plan-2.md`). Loop bound = orchestrator judgment. |
| **Native** | `crew-dag-loop.json` (4 stages) | A `validate` stage runs full build/test, a coverage-gap check, and a **quality audit** (test-gap-analysis, assertion-quality, test-anti-patterns), then fires `loop_to → implement` via `summary(resultType="changes_needed")` with the `NEEDS_WORK` token + categorized FAILING/MISSING/WEAK/SMELL feedback. Loop bound = engine-enforced `max_iterations` (1–10), interruptible. |

Prefer the **native** variant for a robust, engine-bounded coverage loop; the manual variant
exists for when you want the orchestrator fully in control.

## Run

```bash
kiro-cli chat --agent code-testing-generator
# then: "Generate unit tests for <path>"
```

The generator emits one of the two crew payloads (`crew-dag.json` / `crew-dag-loop.json`) as
the `subagent` tool call, substituting your request as `{task}`. Stages hand off through
`.testagent/*.md` on the shared working directory (the crew tool only substitutes `{task}`,
it does not pipe one stage's text into the next).

## Polyglot

Detection and build/test commands are language-agnostic. Each agent reads the matching
extension on demand from
`.kiro/skills/code-testing-extensions/extensions/<lang>.md`
(dotnet, python, typescript, go, java, rust, ruby, swift, kotlin, powershell, cpp).

## Packaging / deployment

These agents reference the skills **in place** via `skill://.kiro/skills/...`,
which is DRY and correct when running from this repo root. To deploy into **another** repo,
make the bundle self-contained: copy `.kiro/skills/code-testing-agent/` and
`.kiro/skills/code-testing-extensions/` into that repo's `.kiro/skills/`, then
update the `skill://` paths in the five agent configs to `skill://.kiro/skills/...`.

## Permissions

- Generator and implementer auto-approve common build/test commands (polyglot allowlist) and
  writes under the workspace (`.git/**` denied). Researcher, planner, and validator can only
  write to `.testagent/**`.
- `toolsSettings.crew` (the documented key; `agent_crew` is its alias) holds
  `availableAgents`/`trustedAgents`. The crew tool itself is granted as `subagent` in the
  generator's `tools`.

## Not ported

The standalone `builder`/`tester`/`fixer`/`linter` agents are intentionally absent (folded
into the implementer). `testability-migration`, `test-quality-auditor`, and `test-migration`
are separate flows and out of scope here.
