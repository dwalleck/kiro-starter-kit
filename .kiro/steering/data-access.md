# Data Access

## EF Core Defaults
- Set `QueryTrackingBehavior.NoTracking` on DbContext by default.
- Use `.AsTracking()` explicitly for queries that need to save changes.
- When NoTracking, call `dbContext.Update(entity)` before `SaveChangesAsync()`.
- Use `AsSplitQuery()` globally to prevent cartesian explosion with multiple Includes.

## Migrations
- Never edit migration files manually. Use `dotnet ef migrations add/remove/script`.
- Never delete or rename migration files directly.
- Use a dedicated migration service (BackgroundService) separate from the main app, especially with Aspire.

## Query Patterns
- Always apply row limits. Every read method takes a `limit` parameter — no unbounded result sets.
- No application-side joins. All joins happen in SQL.
- No N+1 queries. Use `Include()` (EF Core) or batch queries (Dapper).
- Use `ExecuteUpdateAsync`/`ExecuteDeleteAsync` for bulk operations instead of loading entities.
- Project only needed columns with `Select()` — no SELECT *.

## Architecture
- Separate read and write models. Different interfaces, different DTOs, different optimizations.
- No generic repositories (`IRepository<T>`). Build purpose-specific read/write stores.
- Use Dapper for complex read queries. EF Core for writes and simple CRUD. Both can coexist.
- Use `IDbContextFactory<T>` in long-lived objects (actors, background services) instead of injecting DbContext directly.

## Resilience
- Use `CreateExecutionStrategy()` for operations that may fail transiently.
- Transactions must be inside the strategy callback, not outside.
