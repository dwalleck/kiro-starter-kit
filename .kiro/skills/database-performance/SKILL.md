---
name: database-performance
description: CQRS read/write separation with EF Core for writes and Dapper for complex reads, N+1 query detection and prevention, application-side join elimination, row-limited query interfaces, and execution strategies for transient fault handling.
---

# Database Performance Patterns

## When to Use This Skill

Use when designing data access layers, optimizing slow queries, choosing between EF Core and Dapper, or implementing CQRS read/write separation.

## Read/Write Model Separation (CQRS)

Read and write models have different shapes, columns, and purposes. Don't reuse a single entity for both.

```
src/MyApp.Data/Users/
    IUserReadStore.cs          # Multiple optimized projections
    PostgresUserReadStore.cs   # Dapper implementation
    IUserWriteStore.cs         # Command handlers
    PostgresUserWriteStore.cs  # EF Core implementation
    UserProfile.cs             # Read DTO
    UserSummary.cs             # Read DTO (lightweight)
    CreateUserCommand.cs       # Write command
```

### Read Store — multiple specialized projections

```csharp
public interface IUserReadStore
{
    Task<UserProfile?> GetByIdAsync(UserId id, CancellationToken ct = default);
    Task<IReadOnlyList<UserSummary>> GetAllAsync(int limit, UserId? cursor = null, CancellationToken ct = default);
    Task<bool> EmailExistsAsync(EmailAddress email, CancellationToken ct = default);
}
```

### Write Store — accepts commands, minimal return values

```csharp
public interface IUserWriteStore
{
    Task<UserId> CreateAsync(CreateUserCommand command, CancellationToken ct = default);
    Task UpdateAsync(UserId id, UpdateUserCommand command, CancellationToken ct = default);
    Task DeleteAsync(UserId id, CancellationToken ct = default);
}
```

## Always Apply Row Limits

Every read method takes a `limit` parameter. No unbounded result sets.

```csharp
public async Task<IReadOnlyList<OrderSummary>> GetByCustomerAsync(
    CustomerId customerId, int limit, OrderId? cursor = null, CancellationToken ct = default)
{
    await using var connection = await _dataSource.OpenConnectionAsync(ct);

    const string sql = """
        SELECT id, customer_id, total, status, created_at
        FROM orders
        WHERE customer_id = @CustomerId
        AND (@Cursor IS NULL OR created_at < (SELECT created_at FROM orders WHERE id = @Cursor))
        ORDER BY created_at DESC
        LIMIT @Limit
        """;

    var rows = await connection.QueryAsync<OrderRow>(sql, new
    {
        CustomerId = customerId.Value, Cursor = cursor?.Value, Limit = limit
    });

    return rows.Select(r => r.ToOrderSummary()).ToList();
}
```

## N+1 Query Prevention

```csharp
// ❌ N+1 — one query per order
var orders = await _context.Orders.ToListAsync();
foreach (var order in orders)
{
    var items = await _context.OrderItems
        .Where(i => i.OrderId == order.Id).ToListAsync(); // hits DB each iteration!
}

// ✅ EF Core — eager load
var orders = await _context.Orders
    .AsNoTracking()
    .Include(o => o.Items)
    .ToListAsync();

// ✅ Dapper — batch query
const string sql = """
    SELECT id, customer_id, total FROM orders WHERE customer_id = @CustomerId;
    SELECT oi.* FROM order_items oi
    INNER JOIN orders o ON oi.order_id = o.id
    WHERE o.customer_id = @CustomerId;
    """;

using var multi = await connection.QueryMultipleAsync(sql, new { CustomerId = customerId });
var orders = (await multi.ReadAsync<OrderRow>()).ToList();
var items = (await multi.ReadAsync<OrderItemRow>()).ToList();

foreach (var order in orders)
    order.Items = items.Where(i => i.OrderId == order.Id).ToList();
```

## Never Do Application-Side Joins

```csharp
// ❌ Two queries, O(n*m) join in memory
var customers = await _context.Customers.ToListAsync();
var orders = await _context.Orders.ToListAsync();
var result = customers.Select(c => new {
    Customer = c,
    Orders = orders.Where(o => o.CustomerId == c.Id).ToList()
});

// ✅ SQL join
var result = await _context.Customers
    .AsNoTracking()
    .Include(c => c.Orders)
    .ToListAsync();

// ✅ Dapper explicit join
const string sql = """
    SELECT c.id, c.name, COUNT(o.id) as order_count
    FROM customers c
    LEFT JOIN orders o ON c.id = o.customer_id
    GROUP BY c.id, c.name
    """;
```

## Cartesian Explosion Prevention

```csharp
// ❌ 100 reviews × 20 images × 5 categories = 10,000 rows
var product = await _context.Products
    .Include(p => p.Reviews)
    .Include(p => p.Images)
    .Include(p => p.Categories)
    .FirstOrDefaultAsync(p => p.Id == id);

// ✅ Split queries — 4 queries, ~125 rows total
var product = await _context.Products
    .AsSplitQuery()
    .Include(p => p.Reviews)
    .Include(p => p.Images)
    .Include(p => p.Categories)
    .FirstOrDefaultAsync(p => p.Id == id);

// ✅ Best — project only what you need
var product = await _context.Products
    .AsNoTracking()
    .Where(p => p.Id == id)
    .Select(p => new ProductDetail(
        p.Id, p.Name,
        p.Reviews.OrderByDescending(r => r.CreatedAt).Take(10).ToList(),
        p.Images.Take(5).ToList(),
        p.Categories.Select(c => c.Name).ToList()))
    .FirstOrDefaultAsync();
```

## No Generic Repositories

```csharp
// ❌ Can't optimize, no limits, hides N+1
public interface IRepository<T>
{
    Task<T?> GetByIdAsync(int id);
    Task<IEnumerable<T>> GetAllAsync();
    Task<IEnumerable<T>> FindAsync(Expression<Func<T, bool>> predicate);
}

// ✅ Purpose-built
public interface IOrderReadStore
{
    Task<OrderDetail?> GetByIdAsync(OrderId id, CancellationToken ct = default);
    Task<IReadOnlyList<OrderSummary>> GetByCustomerAsync(CustomerId id, int limit, CancellationToken ct = default);
    Task<IReadOnlyList<OrderSummary>> GetPendingAsync(int limit, CancellationToken ct = default);
}
```

## Dapper for Complex Reads

```csharp
public sealed class PostgresUserReadStore : IUserReadStore
{
    private readonly NpgsqlDataSource _dataSource;

    public PostgresUserReadStore(NpgsqlDataSource dataSource) => _dataSource = dataSource;

    public async Task<UserProfile?> GetByIdAsync(UserId id, CancellationToken ct = default)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(ct);

        const string sql = """
            SELECT id, email, name, bio, created_at
            FROM users WHERE id = @Id
            """;

        var row = await connection.QuerySingleOrDefaultAsync<UserRow>(sql, new { Id = id.Value });
        return row?.ToUserProfile();
    }

    private sealed class UserRow
    {
        public Guid id { get; set; }
        public string email { get; set; } = null!;
        public string name { get; set; } = null!;
        public string? bio { get; set; }
        public DateTime created_at { get; set; }

        public UserProfile ToUserProfile() => new(
            new UserId(id), new EmailAddress(email), new PersonName(name),
            bio, new DateTimeOffset(created_at, TimeSpan.Zero));
    }
}
```

## EF Core vs Dapper

| Scenario | Use |
|----------|-----|
| Simple CRUD | EF Core |
| Complex read queries | Dapper |
| Writes with validation | EF Core |
| Bulk operations | Dapper or raw SQL |
| Reporting/analytics | Dapper |

Both can coexist — EF Core for writes, Dapper for reads.

## Entity Configuration

```csharp
public class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.Property(u => u.Email).HasMaxLength(254).IsRequired();
        builder.Property(u => u.Name).HasMaxLength(100).IsRequired();
        builder.Property(u => u.Bio).HasMaxLength(500);
        builder.Property(u => u.Notes).HasColumnType("text");
    }
}
```
