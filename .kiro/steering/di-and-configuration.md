# Dependency Injection and Configuration

## DI Organization
- Group related registrations into `Add{Feature}Services()` extension methods on `IServiceCollection`.
- Place extension methods near the services they register, not in Program.cs.
- Return `IServiceCollection` for chaining.
- Compose hierarchically: `AddAppServices()` calls `AddDomainServices()`, `AddInfrastructureServices()`, etc.

## Lifetimes
- Singleton: stateless, thread-safe, expensive to create (caches, HttpClient factories, template renderers).
- Scoped: stateful per-request (DbContext, repositories).
- Transient: lightweight, cheap to create (validators, short-lived helpers).
- Never inject scoped services into singletons. Inject `IServiceProvider` or `IServiceScopeFactory` and create a scope per operation.
- In background services and actors, always create a scope per unit of work.

## Configuration
- Bind settings to strongly-typed classes with `AddOptions<T>().BindConfiguration()`.
- Always call `.ValidateDataAnnotations().ValidateOnStart()` — fail fast on bad config.
- Use `IValidateOptions<T>` for cross-property or conditional validation. Return `ValidateOptionsResult.Fail()`, never throw.
- Use `IOptions<T>` for static config, `IOptionsMonitor<T>` for background services that need live reload.
- Never read `IConfiguration` directly in services. Always use `IOptions<T>`.

## Anti-Patterns
- No massive Program.cs with hundreds of inline registrations.
- No hidden configuration (hardcoded connection strings inside extension methods).
- No constructor validation of options — that's what `ValidateOnStart` is for.
