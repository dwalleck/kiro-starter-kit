# .NET Aspire

## Architecture
- AppHost owns all Aspire hosting packages. Application projects never reference Aspire client or service-discovery packages.
- AppHost translates resource outputs into explicit config keys via `WithEnvironment()`.
- App code binds to `IOptions<T>` and `Configuration` only — no opaque service discovery.
- Every value injected by AppHost must be representable as an environment variable in production without Aspire.

## ServiceDefaults
- One shared ServiceDefaults project referenced by all services.
- Centralizes OpenTelemetry (logging, tracing, metrics), health checks, resilience, and service discovery.
- Every service calls `builder.AddServiceDefaults()` and `app.MapDefaultEndpoints()`.
- Filter health check endpoints from traces to reduce noise.
- Tag health checks: `"live"` for liveness, default for readiness.

## Integration Testing
- Use `DistributedApplicationTestingBuilder` from `Aspire.Hosting.Testing`.
- Migration services run first: use `.WaitForCompletion(migrations)` on dependent projects.
- Pass configuration overrides through the test builder, not by modifying app code.

## Don't
- Don't set `ASPIRE_ALLOW_UNSECURED_TRANSPORT=true` to work around TLS issues. Fix the dev cert trust instead.
- Don't add Aspire client packages to application projects.
- Don't rely on service discovery that can't be replicated in production without Aspire.
