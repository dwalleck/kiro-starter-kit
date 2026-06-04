---
name: code-testing-agent-ide
description: >-
  Generates and writes new unit tests for any programming language using a
  Research-Plan-Implement-Validate pipeline, orchestrated by the main agent
  through IDE subagents. Use when asked to generate tests, write unit tests,
  add tests, improve test coverage, create test project, achieve high
  coverage, comprehensive tests, or asked to scaffold a new test project for
  an app, service, or library. Supports C#, TypeScript, JavaScript, Python,
  Go, Rust, Java, and more. You (the main agent) launch the
  code-testing-researcher-ide, code-testing-planner-ide,
  code-testing-implementer-ide, and code-testing-validator-ide subagents in
  sequence so tests compile, pass, and follow project conventions. DO NOT USE
  FOR: running existing tests or test filters (use run-tests); diagnosing
  coverage plateaus or project-wide coverage/CRAP analysis without writing
  tests (use coverage-analysis); targeted method/class CRAP scores (use
  crap-score); MSTest assertion guidance, MSTest test pattern modernization,
  or fixing existing MSTest test code (use writing-mstest-tests).
license: MIT
---

# Code Testing Generation Skill (IDE)

An AI-powered skill that generates comprehensive, workable unit tests for any programming language using a coordinated subagent pipeline. This is the **IDE variant**: instead of a CLI crew engine with a declarative DAG, **you (the main agent) are the orchestrator**. You launch each stage subagent in order and drive the fix loop yourself, because IDE subagents run in isolation and cannot launch other subagents.

## When to Use This Skill

Use this skill when you need to:

- Generate unit tests for an entire project or specific files
- Improve test coverage for existing codebases
- Create test files that follow project conventions
- Write tests that actually compile and pass
- Add tests for new features or untested code

## When Not to Use

- Running or executing existing tests (use the `run-tests` skill)
- Migrating between test frameworks (use migration skills)
- Writing tests specifically for MSTest patterns (use `writing-mstest-tests`)
- Debugging failing test logic

## How It Works

You coordinate four specialized subagents in a **Research → Plan → Implement → Validate** pipeline. There is no crew engine and no `code-testing-generator` agent in the IDE: ordering is enforced by you launching one subagent at a time and waiting for each to finish, and state is handed off through files in `.testagent/` on the shared working directory.

### Pipeline Overview

```text
        YOU (main agent) — the orchestrator
        launch each stage in order; loop implement↔validate
                              │
   ┌───────────────┬──────────┼───────────────┬───────────────────┐
   ▼               ▼          ▼               ▼                   ▼
┌───────────┐ ┌───────────┐ ┌───────────────┐ ┌───────────────────────┐
│RESEARCHER │ │ PLANNER   │ │ IMPLEMENTER   │ │ VALIDATOR             │
│  -ide     │ │  -ide     │ │  -ide         │ │  -ide                 │
│ Analyzes  │→│ Creates   │→│ Writes tests, │→│ Full build/test +     │
│ codebase  │ │ phased    │ │ builds/tests/ │ │ coverage gap + quality│
│           │ │ plan      │ │ fixes inline  │ │ audit; returns verdict│
└─────┬─────┘ └─────┬─────┘ └──────┬────────┘ └───────────┬───────────┘
 research.md    plan.md      tests + status.md      NEEDS_WORK / VALIDATION_PASSED
                                   ▲                       │
                                   └───────────────────────┘
                              loop on NEEDS_WORK (max 3 iterations)
```

The implementer absorbs the former builder/tester/fixer/linter roles and runs build/test/fix inline via shell. There is one implementer pass that loops all phases internally — the planner decides the phase count at runtime.

## Step-by-Step Instructions

### Step 1: Determine the user request

Make sure you understand what the user is asking and for what scope.
When the user does not express strong requirements for test style, coverage goals, or conventions, source the guidelines from [unit-test-generation.prompt.md](unit-test-generation.prompt.md). This prompt provides best practices for discovering conventions, parameterization strategies, coverage goals (aim for 80%), and language-specific patterns.

### Step 2: Choose a strategy

| Strategy | When | What you do |
|---|---|---|
| **Direct** | A single small file/class testable without the pipeline | Skip the subagents. Write tests yourself, build/test/fix inline, then validate (Step 7). |
| **Single pass** | A module or a few files one R→P→I cycle covers | Run the pipeline once (Steps 3–6), then report. |
| **Iterative** | Large scope or a coverage target one pass can't meet | Run the pipeline, then repeat the implement↔validate loop (Step 6) on remaining gaps. |

Default to **Direct** unless the request names multiple files/modules or a whole project.

### Step 3: Research Phase

Launch the `code-testing-researcher-ide` subagent. Pass it the user's request verbatim plus the instruction to write findings to `.testagent/research.md`. Wait for it to finish before proceeding.

It detects language & framework, maps project structure and dependencies, discovers build/test commands, inventories existing tests, and estimates per-file coverage.

Output: `.testagent/research.md`

### Step 4: Planning Phase

Launch the `code-testing-planner-ide` subagent. It reads `.testagent/research.md`, groups in-scope files into 2–5 leaf-first phases, specifies test cases per file, and defines success criteria. Wait for it to finish.

Output: `.testagent/plan.md`

### Step 5: Implementation Phase

Launch the `code-testing-implementer-ide` subagent. It reads `.testagent/plan.md` and `.testagent/research.md` and implements **every** phase in order: reads sources in full, writes test files, then builds and runs the affected test project inline (build retry 3×, test retry 5×), fixing failing assertions against real behavior. It appends a per-phase result block to `.testagent/status.md`. Wait for it to finish.

Output: test files + `.testagent/status.md`

### Step 6: Validation Phase (and the fix loop)

Launch the `code-testing-validator-ide` subagent. It runs a full non-incremental build, a fresh full test run, a coverage-gap check, and a quality audit (test-gap-analysis, assertion-quality, test-anti-patterns), then returns a verdict:

- **`VALIDATION_PASSED`** → proceed to Step 7.
- **`NEEDS_WORK`** followed by a categorized `FAILING:` / `MISSING:` / `WEAK:` / `SMELL:` list → re-launch the `code-testing-implementer-ide` subagent, passing that categorized feedback as its input. The implementer addresses only the named gaps (it does not redo phases already marked `SUCCESS`). Then re-launch the validator.

Repeat this implement↔validate loop until the validator returns `VALIDATION_PASSED` or you have run **3** implement→validate iterations, whichever comes first. The loop bound is enforced by you, the orchestrator — count the iterations and stop at 3 even if gaps remain, reporting them as follow-ups.

### Step 7: Report

Summarize: strategy used, tests created/passing/failing, files created, scoped vs. full build results, quality-audit summary, and next steps. **Do NOT delete `.testagent/`** — leave `research.md`/`plan.md`/`status.md` in place as the run's audit trail, and advise the user to add `.testagent/` to `.gitignore`.

### Coverage Types

- **Happy path**: Valid inputs produce expected outputs
- **Edge cases**: Empty values, boundaries, special characters
- **Error cases**: Invalid inputs, null handling, exceptions

## State Management

All pipeline state is stored in the `.testagent/` folder and is how stages hand off to each other (subagents do not pipe their text to one another):

| File                     | Purpose                      | Written by |
| ------------------------ | ---------------------------- | ---------- |
| `.testagent/research.md` | Codebase analysis results    | researcher-ide |
| `.testagent/plan.md`     | Phased implementation plan   | planner-ide |
| `.testagent/status.md`   | Per-phase progress + validator findings | implementer-ide / validator-ide |

## Examples

### Strategy Selection

| User Request | Strategy | Why |
|---|---|---|
| "Generate tests for `src/services/UserService.ts`" | **Direct** | Single file, small scope — write tests immediately, skip subagents |
| "Add unit tests for my billing project" | **Single pass** | Moderate scope — one Research → Plan → Implement → Validate cycle covers it |
| "Achieve 80% coverage across the entire solution" | **Iterative** | Large scope — run the pipeline, then loop implement↔validate on remaining gaps |

### Pipeline Walkthrough

Given a request like *"Generate unit tests for my InvoiceService"*, the pipeline produces:

1. **Research** → `.testagent/research.md` containing detected language/framework, build commands, files to test ranked by priority, and existing test inventory
2. **Plan** → `.testagent/plan.md` containing a phased approach with specific methods and test scenarios (happy path, edge cases, error cases) for each file
3. **Implement** → Test files written, built, and verified per phase. Fix cycle runs automatically (inline) if build/test errors occur
4. **Validate** → Full workspace build + full test run + coverage-gap + quality audit; returns `VALIDATION_PASSED` or `NEEDS_WORK` + categorized feedback
5. **Report** → Summary of tests created, pass/fail counts, coverage notes, and next steps

### Language-Specific Examples

The `code-testing-extensions` skill provides concrete, filled-in examples for each pipeline phase. Read `.kiro/skills/code-testing-extensions/SKILL.md` by path to discover available extension files, then read:

- **`dotnet-examples.md`** — MSTest example with InvoiceService: research output, plan output, generated test file, fix cycle walkthrough, and final report
- **`python-examples.md`** — pytest example with the same InvoiceService scenario: research, plan, generated test file (parametrized, `unittest.mock`), fix cycles (`ModuleNotFoundError`, patch target, `Mock(spec=...)`), and final report
- **`typescript-examples.md`** — Vitest example (also applicable to Jest) showing `it.each` parameterization, async tests, fake timers, and ESM/CJS fix cycles
- **`go-examples.md`** — Standard `testing` package example with table-driven subtests, hand-written fake repository, injected clock, and `-run` regex fix cycle
- **`java-examples.md`** — JUnit 5 + Mockito example on Maven showing `@ExtendWith(MockitoExtension.class)`, `@ParameterizedTest` + `@CsvSource`, `Clock.fixed(...)` for time, and Surefire fix cycles

For languages without a dedicated examples file (Rust, Ruby, Swift, Kotlin, C++, PowerShell), use the base extension file (`<language>.md`) plus the example file for the closest paradigm — the pipeline shape (research → plan → generate → fix) and the categories of decisions (test layout, mocking strategy, fixed clock for time-dependent code, parameterization style) translate directly.

## Agent Reference

| Agent                          | Purpose              |
| ------------------------------ | -------------------- |
| (you, the main agent)          | Orchestrates the pipeline and drives the fix loop |
| `code-testing-researcher-ide`  | Analyzes codebase → `research.md` |
| `code-testing-planner-ide`     | Creates test plan → `plan.md` |
| `code-testing-implementer-ide` | Writes test files; builds/tests/fixes inline → `status.md` |
| `code-testing-validator-ide`   | Full build/test + coverage-gap + quality audit; returns the loop verdict |

## Requirements

- Project must have a build/test system configured
- Testing framework should be installed (or installable)

## Troubleshooting

### Tests don't compile

The `code-testing-implementer-ide` subagent attempts to resolve compilation errors inline (build retry up to 3×). Check `.testagent/plan.md` for the expected test structure. Read `.kiro/skills/code-testing-extensions/SKILL.md` and the language-specific extension file for error code references (e.g., `dotnet.md` for .NET).

### Tests fail

Most failures in generated tests are caused by **wrong expected values in assertions**, not production code bugs:

1. Read the actual test output
2. Read the production code to understand correct behavior
3. Fix the assertion, not the production code
4. Never mark tests `[Ignore]` or `[Skip]` just to make them pass

### Wrong testing framework detected

Specify your preferred framework in the initial request: "Generate Jest tests for..."

### Environment-dependent tests fail

Tests that depend on external services, network endpoints, specific ports, or precise timing will fail in CI environments. Focus on unit tests with mocked dependencies instead.

### Build fails on full solution

During phase implementation, the implementer builds only the specific test project for speed. The validator then runs a full non-incremental workspace build to catch cross-project errors.

### The loop won't converge

If the validator keeps returning `NEEDS_WORK` after 3 implement→validate iterations, stop and report the remaining `FAILING`/`MISSING`/`WEAK`/`SMELL` items as follow-ups rather than looping further.
