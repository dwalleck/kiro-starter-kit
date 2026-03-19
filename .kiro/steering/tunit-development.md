# TUnit Development

## Project Setup
- Run tests with `dotnet run`, never `dotnet test`. Use `--` to pass args to the test executable.
- `OutputType` must be `Exe`. Target `net8.0` or later. Delete `Program.cs` — TUnit generates its own entry point.
- Never add `Microsoft.NET.Test.Sdk`, `coverlet.collector`, or `coverlet.msbuild`. All conflict with Microsoft.Testing.Platform.

## Assertions
- Always `await Assert.That(...)`. Unawaited assertions are no-ops — the test silently passes. Don't suppress the analyzer warning.
- Use specific assertions (`IsEqualTo`, `Contains`, `HasCount`) over generic boolean checks (`IsTrue`).
- Use `Assert.Multiple()` when verifying multiple properties of one object — reports all failures, not just the first.

## Test Methods
- `async Task` only. `async void` is a compiler error.
- Fresh class instance per test — instance state does not carry between tests.
- One logical assertion per test. Multiple assertions of the same behavior are fine.
- Name tests `Method_Scenario_ExpectedBehavior`. Be consistent across the project.
- Test observable behavior, not implementation details. Don't verify method call counts.

## Lifecycle & Shared Resources
- `[Before(Test)]`/`[After(Test)]` must be instance methods. All other hooks (`Class`, `Assembly`, `TestSession`, `BeforeEvery`, `AfterEvery`) must be static.
- Don't put expensive setup in `[Before(Test)]` — it runs before every test. Use `[Before(Class)]` or `[ClassDataSource<T>]`.
- Use `[ClassDataSource<T>]` with `SharedType` for expensive resources (containers, web servers). Not static fields.
- `[After]` hooks run even if the test or earlier hooks fail.

## Parallelism
- All tests run in parallel by default. Write independent, self-contained tests.
- Use `[NotInParallel("key")]` with constraint keys. Without keys = runs completely alone (maximally restrictive).
- Use `[DependsOn]` for test ordering — preserves parallelism for unrelated tests. Prefer over `[NotInParallel(Order = N)]`.
- Don't mix `[DependsOn]` across different `[ParallelGroup]` or `[ParallelLimiter]` scopes.

## Filtering
- Use `--treenode-filter` with path syntax `/<Assembly>/<Namespace>/<Class>/<Test>` for test filtering.
- Supports wildcards (`*`), property filters (`[Category=Smoke]`), negation (`[Category!=Slow]`), AND (`&`), and OR (`|` with parens).

## Timeouts
- Accept `CancellationToken` in test methods when using `[Timeout]` — forward it to all async calls. The token is cancelled when the timeout expires.
- Use `[assembly: Timeout(...)]` for a global safety net. Precedence: method > class > assembly.
- With `[Retry]`, each attempt gets a fresh timeout window.

## Mocking
- Use TUnit.Mocks (source-generated, AOT-compatible). No `Arg.` prefix — `Any()`, inline lambdas, and raw values work directly.
- Only mock expensive/external dependencies. Use real implementations for validators, calculators, simple logic.

## Coverage
- Use built-in `--coverage` flag (`dotnet run -c Release -- --coverage`). Coverlet is incompatible.
