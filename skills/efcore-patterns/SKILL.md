---
name: efcore-patterns
description: EF Core entity configuration with IEntityTypeConfiguration, migration workflows with dedicated migration services, query optimization using AsSplitQuery and projection, ExecuteUpdateAsync/ExecuteDeleteAsync for bulk operations, and IDbContextFactory for long-lived services.
---

# Entity Framework Core Patterns

## When to Use This Skill

Use when setting up EF Core in a new project, managing migrations, optimizing queries, integrating with Aspire, or debugging change tracking issues.

## NoTracking by Default

```csharp
public class ApplicationDbContext : DbContext
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
        : base(options)
    {
        ChangeTracker.QueryTrackingBehavior = QueryTrackingBehavior.NoTracking;
    }

    public DbSet<Order> Orders => Set<Order>();
}
```

When NoTracking is active, writes require explicit handling:

```csharp
// ❌ Entity not tracked — SaveChanges does nothing
var order = await dbContext.Orders.FirstOrDefaultAsync(o => o.Id == orderId);
order.Status = OrderStatus.Shipped;
await dbContext.SaveChangesAsync(); // Nothing happens!

// ✅ Explicitly mark for update
var order = await dbContext.Orders.FirstOrDefaultAsync(o => o.Id == orderId);
order.Status = OrderStatus.Shipped;
dbContext.Orders.Update(order);
await dbContext.SaveChangesAsync();

// ✅ Or use AsTracking() for the query
var order = await dbContext.Orders
    .AsTracking()
    .FirstOrDefaultAsync(o => o.Id == orderId);
order.Status = OrderStatus.Shipped;
await dbContext.SaveChangesAsync();
```

## Migration Management

Always use CLI commands. Never edit, delete, or rename migration files directly.

```bash
# Create
dotnet ef migrations add AddCustomerTable \
    --project src/MyApp.Infrastructure \
    --startup-project src/MyApp.Api

# Remove last (if not applied)
dotnet ef migrations remove \
    --project src/MyApp.Infrastructure \
    --startup-project src/MyApp.Api

# Generate idempotent SQL script
dotnet ef migrations script --idempotent \
    --project src/MyApp.Infrastructure \
    --startup-project src/MyApp.Api
```

## Dedicated Migration Service with Aspire

Separate migration execution from the main application:

```csharp
// MigrationWorker.cs
public class MigrationWorker : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly IHostApplicationLifetime _lifetime;

    public MigrationWorker(IServiceProvider sp, IHostApplicationLifetime lifetime)
    {
        _serviceProvider = sp;
        _lifetime = lifetime;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var strategy = db.Database.CreateExecutionStrategy();

        await strategy.ExecuteAsync(() => db.Database.MigrateAsync(stoppingToken));
        _lifetime.StopApplication();
    }
}
```

AppHost wiring — API waits for migrations to finish:

```csharp
var migrations = builder.AddProject<Projects.MyApp_MigrationService>("migrations")
    .WaitFor(db).WithReference(db);

var api = builder.AddProject<Projects.MyApp_Api>("api")
    .WaitForCompletion(migrations)
    .WithReference(db);
```

## ExecutionStrategy for Transient Failures

Transactions must be inside the strategy callback:

```csharp
var strategy = _dbContext.Database.CreateExecutionStrategy();

await strategy.ExecuteAsync(async () =>
{
    await using var transaction = await _dbContext.Database.BeginTransactionAsync();
    // ... operations ...
    await _dbContext.SaveChangesAsync();
    await transaction.CommitAsync();
});
```

## Bulk Operations

Use `ExecuteUpdateAsync`/`ExecuteDeleteAsync` instead of loading entities:

```csharp
// ❌ Loads all entities into memory
var expired = await _db.Orders.Where(o => o.ExpiresAt < now).ToListAsync();
foreach (var o in expired) o.Status = OrderStatus.Expired;
await _db.SaveChangesAsync();

// ✅ Single SQL UPDATE
await _db.Orders
    .Where(o => o.ExpiresAt < now)
    .ExecuteUpdateAsync(s => s
        .SetProperty(o => o.Status, OrderStatus.Expired)
        .SetProperty(o => o.UpdatedAt, DateTimeOffset.UtcNow));
```

## Query Splitting

Enable globally to prevent cartesian explosion with multiple Includes:

```csharp
services.AddDbContext<ApplicationDbContext>(options =>
    options.UseNpgsql(connectionString, o =>
        o.UseQuerySplittingBehavior(QuerySplittingBehavior.SplitQuery)));
```

Override per-query when single query is better:

```csharp
var orders = await dbContext.Orders
    .Include(o => o.Items)
    .Include(o => o.Payments)
    .AsSingleQuery()  // override global split
    .ToListAsync();
```

| Behavior | Pros | Cons |
|----------|------|------|
| SplitQuery | No cartesian explosion | Multiple round-trips |
| SingleQuery | Single round-trip, transactional consistency | Cartesian explosion with multiple collections |

## Projection Over SELECT *

```csharp
// ❌ Fetches all columns
var orders = await _db.Orders.Include(o => o.Items).ToListAsync();

// ✅ Only needed columns
var orders = await _db.Orders
    .Where(o => o.CustomerId == customerId)
    .Select(o => new OrderSummary(
        o.Id, o.Total, o.Status,
        o.Items.Count))
    .ToListAsync();
```

## DbContext Lifetime

```csharp
// ASP.NET Core — scoped (one per request, default)
builder.Services.AddDbContext<ApplicationDbContext>(o => o.UseNpgsql(cs));

// Background services — create scope per unit of work
using var scope = _serviceProvider.CreateScope();
var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

// Actors / long-lived objects — factory pattern
builder.Services.AddDbContextFactory<ApplicationDbContext>(o => o.UseNpgsql(cs));

// In actor:
await using var db = await _dbFactory.CreateDbContextAsync();
```

## Common Pitfalls

```csharp
// N+1 — query per iteration
// ❌
foreach (var id in orderIds)
    await _db.Orders.FindAsync(id);
// ✅
await _db.Orders.Where(o => orderIds.Contains(o.Id)).ToListAsync();

// Sync in async context
// ❌
var orders = _db.Orders.ToList();
// ✅
var orders = await _db.Orders.ToListAsync();
```
