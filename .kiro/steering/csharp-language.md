# C# Language Conventions

## Formatting and Naming
- Allman braces. 4 spaces, no tabs.
- `_camelCase` for private/internal fields. `readonly` where possible.
- Always specify visibility. Visibility is the first modifier (`public abstract` not `abstract public`).
- Avoid `this.` unless necessary.
- `var` only when type is explicit on the RHS (`var s = new FileStream(...)` — not `var s = OpenStream()`).
- Target-typed `new()` only when type is explicit on the LHS (`FileStream s = new(...)` — not `s = new(...)`).
- Language keywords over BCL types (`int` not `Int32`, `int.Parse` not `Int32.Parse`).
- PascalCase for constants and local functions. No SCREAMING_CASE.
- `nameof(...)` over string literals.
- Fields at the top of type declarations.
- Imports outside namespace, `System.*` first, then alphabetical.
- Single-statement `if`: never single-line form. Braces are always required for conditional statements.
- Primary constructor params: `camelCase`, no `_` prefix. Assign to `_`-prefixed fields in larger types.
- When editing existing files, match the existing style.

## Types and Immutability
- Use `record` for DTOs, messages, events, and domain entities.
- Use `readonly record struct` for value objects (OrderId, Money, EmailAddress). Never use classes for value objects.
- Seal classes by default. Only unseal when explicitly designing for inheritance.
- Seal records too — they're classes.
- No abstract base classes. Use interfaces + composition.
- No implicit conversion operators on value objects. Use explicit conversions only.

## Nullable Reference Types
- `<Nullable>enable</Nullable>` is required in all projects.
- Respect all nullable warnings. Do not suppress with `#pragma warning disable`.
- Use `ArgumentNullException.ThrowIfNull()` for guard clauses.

## Pattern Matching
- Prefer `switch` expressions over if/else chains.
- Use property patterns, relational patterns, and list patterns where they improve clarity.

## Async
- Accept `CancellationToken` on all async methods with `= default`.
- Flow `CancellationToken` to every API that accepts one — cancellation is cooperative.
- Use `ConfigureAwait(false)` in library code.
- Never block on async — no `.Result`, `.Wait()`, or `.GetAwaiter().GetResult()`.
- Never use `async void`. Always return `Task`/`Task<T>`. Includes lambdas — use `Func<Task>` overloads.
- Prefer `await` over `ContinueWith`. Prefer `async`/`await` over directly returning `Task`.
- Use `Task.FromResult`/`ValueTask` for pre-computed values, never `Task.Run`.
- Use `ValueTask` only for hot paths that often complete synchronously. When in doubt, use `Task`.
- Always create `TaskCompletionSource<T>` with `TaskCreationOptions.RunContinuationsAsynchronously`.
- Always dispose `CancellationTokenSource` used for timeouts (`using`/`await using`).
- Use `await using` for streams/writers that do I/O, or call `FlushAsync` before `Dispose`.
- Use `Task.WaitAsync` (.NET 6+) for timeout/cancellation of uncancellable operations.
- Use `IAsyncEnumerable` for streaming results.
- Don't store disposable or non-thread-safe objects in `AsyncLocal<T>`. Set async locals in async methods only.

## ASP.NET Core
- Never store `HttpContext` in a field. Store `IHttpContextAccessor` and read `.HttpContext` at call time.
- `HttpContext` is not thread-safe. Copy needed data before any parallel work.
- Don't capture `HttpContext` or scoped services in background threads. Use `IServiceScopeFactory` to create a new scope.
- Use async overloads on `HttpRequest.Body` and `HttpResponse.Body` — Kestrel does not support sync reads.
- Use `HttpRequest.ReadFormAsync()`, never `HttpRequest.Form` (sync-over-async under the covers).
- Don't add headers after `HttpResponse` has started. Use `Response.OnStarting()` for late headers.

## Performance Defaults
- Prefer static pure functions when no instance state is needed.
- Defer `.ToList()` — single materialization at the end of LINQ chains.
- Return `IReadOnlyList<T>` or `IReadOnlyCollection<T>` from API boundaries, not `List<T>`.
- Use `FrozenDictionary`/`FrozenSet` for static lookup data (.NET 8+).
- Use `Span<T>` for synchronous buffer operations, `Memory<T>` for async.
- Use `ArrayPool<T>.Shared` for large temporary buffers instead of repeated allocation.

## Banned Patterns
- No AutoMapper, Mapster, or reflection-based mapping libraries. Write explicit mapping methods.
- No `BinaryFormatter` — ever.
- No manual thread creation (`new Thread()`) for short-lived work. Use `Task.Run` or higher abstractions.
- For long-running blocking work (queue processors), use `TaskCreationOptions.LongRunning` or a dedicated `Thread` with `IsBackground = true`.
- No `lock` for business logic. Redesign with immutability, Channels, or actors.

## Concurrency Escalation
- Start with async/await for I/O.
- `Parallel.ForEachAsync` for CPU-bound parallel work.
- `Channel<T>` for producer/consumer queues.
- Only reach for Rx or actors when simpler tools don't fit.
