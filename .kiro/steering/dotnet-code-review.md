# .NET Code Review Conventions

These conventions inform the code review agents about .NET-specific patterns that should not be flagged as issues.

## Trust Boundary Conventions

- `IOptions<T>`, `IOptionsSnapshot<T>`, `IOptionsMonitor<T>` — trusted configuration. Validated at startup via `IValidateOptions<T>`, not at point of use. Flag misconfiguration as Suggestion (≤ 40).
- `IConfiguration`, `IConfigurationSection` — trusted configuration set by operators. Same severity cap.
- `appsettings.json`, `appsettings.{Environment}.json` — operator-managed configuration files.
- Environment variables read via `Environment.GetEnvironmentVariable` — trusted.

## ORM Entity Conventions

- Entity classes in namespaces containing `Entities` or `Models` that map to database tables require mutable public setters for ORM compatibility (Dapper, EF Core). Don't flag mutable setters on these types unless there's evidence they're used as domain objects with enforced invariants.
- When a property type seems wrong (e.g., `double` for money, `int` for boolean), check for a comment explaining the legacy database mapping (e.g., `FLOAT` column, `BIT` column) before flagging the type choice.

## Thread-Safe Types

These .NET types are thread-safe by design. Do not flag concurrent access as a race condition:
- `MemoryCache`, `IMemoryCache`
- `ConcurrentDictionary<TKey, TValue>`
- `ConcurrentQueue<T>`, `ConcurrentStack<T>`, `ConcurrentBag<T>`
- `ImmutableArray<T>`, `ImmutableList<T>`, `ImmutableDictionary<TKey, TValue>`, and other `Immutable*` types
- `Channel<T>`
- `Interlocked` operations

A cache race causing duplicate work (two concurrent misses both fetching) is severity ≤ 55 unless it causes side effects like rate limiting, billing, or external writes.

## Record Types

- `record` types with positional parameters are immutable by default. Don't flag for missing encapsulation.
- `record struct` is a value type — different equality and allocation semantics than `record class`.

## Namespace Role Conventions

When reviewing type design, check the namespace to determine expected encapsulation level:
- `Dtos` namespace → serialization types, mutable setters expected
- `Entities` or `Models` namespace → ORM-mapped, mutable setters required
- `Options` namespace → configuration binding types, mutable setters required for `IOptions<T>` binding
- `Results` namespace → typically immutable records, flag mutability here
- `Commands` / `Queries` namespace → typically immutable records (CQRS pattern)

## Framework Exception Types

- Use `ArgumentException`, `ArgumentNullException`, `ArgumentOutOfRangeException` for parameter validation — not custom exceptions.
- Use `InvalidOperationException` for invalid state transitions.
- Use `NotSupportedException` for intentionally unimplemented interface members.
- Use `OperationCanceledException` / `TaskCanceledException` for cancellation — don't catch and rethrow as a different type.

## Async Error Handling

- `OperationCanceledException` in async code is normal control flow (client disconnected, timeout). Logging at `Debug` or `Information` level is appropriate — don't flag as inadequate error handling.
- `HttpRequestException` in `HttpClient` calls should be caught specifically, not via a broad `Exception` catch.
