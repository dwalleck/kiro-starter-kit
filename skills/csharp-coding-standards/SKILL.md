---
name: modern-csharp-coding-standards
description: Implementing value objects with readonly record structs, replacing inheritance hierarchies with interface composition, explicit mapping methods instead of AutoMapper, Result type for expected errors, and Span<T>/Memory<T> zero-allocation patterns in C# 12+.
---

# Modern C# Coding Standards

## When to Use This Skill

Use when implementing value objects, designing domain models with strong typing, replacing inheritance with composition, writing explicit mapping methods, implementing Result types for error handling, or optimizing with Span<T>/Memory<T>.

## Value Objects as readonly record struct

Value objects are always `readonly record struct`. No implicit conversions — they defeat type safety.

```csharp
// Single-value: strongly-typed ID
public readonly record struct OrderId(string Value)
{
    public OrderId(string value) : this(
        !string.IsNullOrWhiteSpace(value)
            ? value
            : throw new ArgumentException("OrderId cannot be empty", nameof(value)))
    { }
    public override string ToString() => Value;
}

public readonly record struct CustomerId(Guid Value)
{
    public static CustomerId New() => new(Guid.NewGuid());
}

// Multi-value with validation and operations
public readonly record struct Money(decimal Amount, string Currency)
{
    public Money(decimal amount, string currency) : this(
        amount >= 0 ? amount : throw new ArgumentException("Amount cannot be negative"),
        ValidateCurrency(currency))
    { }

    private static string ValidateCurrency(string currency)
    {
        if (string.IsNullOrWhiteSpace(currency) || currency.Length != 3)
            throw new ArgumentException("Currency must be a 3-letter code");
        return currency.ToUpperInvariant();
    }

    public Money Add(Money other)
    {
        if (Currency != other.Currency)
            throw new InvalidOperationException($"Cannot add {Currency} to {other.Currency}");
        return new Money(Amount + other.Amount, Currency);
    }
}

// Factory pattern with Result for complex validation
public readonly record struct PhoneNumber
{
    public string Value { get; }
    private PhoneNumber(string value) => Value = value;

    public static Result<PhoneNumber, string> Create(string input)
    {
        if (string.IsNullOrWhiteSpace(input))
            return Result<PhoneNumber, string>.Failure("Phone number cannot be empty");
        var digits = new string(input.Where(char.IsDigit).ToArray());
        if (digits.Length < 10 || digits.Length > 15)
            return Result<PhoneNumber, string>.Failure("Phone number must be 10-15 digits");
        return Result<PhoneNumber, string>.Success(new PhoneNumber(digits));
    }
}
```

### No Implicit Conversions

```csharp
// ❌ Defeats compile-time safety
public readonly record struct UserId(Guid Value)
{
    public static implicit operator UserId(Guid value) => new(value);  // NO!
    public static implicit operator Guid(UserId value) => value.Value; // NO!
}
// This compiles silently: ProcessUser(Guid.NewGuid()); // meant PostId!

// ✅ All conversions explicit
var userId = new UserId(request.UserId);           // boundary IN
await _db.ExecuteAsync(sql, new { UserId = userId.Value }); // boundary OUT
```

## Composition Over Inheritance

No abstract base classes. Use interfaces + composition. Static helpers for shared logic. Records with factory methods for variants.

```csharp
// ❌ Abstract base class hierarchy
public abstract class PaymentProcessor
{
    public abstract Task<PaymentResult> ProcessAsync(Money amount);
    protected async Task<bool> ValidateAsync(Money amount) { /* shared */ }
}
public class CreditCardProcessor : PaymentProcessor { /* override */ }

// ✅ Composition with interfaces
public interface IPaymentProcessor
{
    Task<PaymentResult> ProcessAsync(Money amount, CancellationToken ct);
}

public interface IPaymentValidator
{
    Task<ValidationResult> ValidateAsync(Money amount, CancellationToken ct);
}

public sealed class CreditCardProcessor : IPaymentProcessor
{
    private readonly IPaymentValidator _validator;
    private readonly ICreditCardGateway _gateway;

    public CreditCardProcessor(IPaymentValidator validator, ICreditCardGateway gateway)
    {
        _validator = validator;
        _gateway = gateway;
    }

    public async Task<PaymentResult> ProcessAsync(Money amount, CancellationToken ct)
    {
        var validation = await _validator.ValidateAsync(amount, ct);
        if (!validation.IsValid)
            return PaymentResult.Failed(validation.Error);
        return await _gateway.ChargeAsync(amount, ct);
    }
}

// ✅ Static helpers for shared logic (not inheritance)
public static class PaymentValidation
{
    public static ValidationResult ValidateAmount(Money amount) => amount.Amount switch
    {
        <= 0 => ValidationResult.Invalid("Amount must be positive"),
        > 10000m => ValidationResult.Invalid("Amount exceeds maximum"),
        _ => ValidationResult.Valid()
    };
}

// ✅ Records with factory methods for variants (not inheritance)
public record PaymentMethod
{
    public PaymentType Type { get; init; }
    public string? Last4 { get; init; }
    public string? AccountNumber { get; init; }

    public static PaymentMethod CreditCard(string last4) => new() { Type = PaymentType.CreditCard, Last4 = last4 };
    public static PaymentMethod BankTransfer(string account) => new() { Type = PaymentType.BankTransfer, AccountNumber = account };
    public static PaymentMethod Cash() => new() { Type = PaymentType.Cash };
}
```

## Explicit Mapping (No AutoMapper)

```csharp
// ❌ AutoMapper — compiles fine, fails at runtime
var dto = _mapper.Map<UserDto>(entity);
// Id: string vs Guid mismatch, Name vs FullName: no match → null

// ✅ Extension methods — compile-time checked, debuggable, refactorable
public static class UserMappings
{
    public static UserDto ToDto(this UserEntity entity) => new(
        Id: entity.Id.ToString(),
        Name: entity.FullName,
        Email: entity.EmailAddress);

    public static UserEntity ToEntity(this CreateUserRequest request) => new(
        Id: Guid.NewGuid(),
        FullName: request.Name,
        EmailAddress: request.Email);
}

// Complex mapping with pattern matching
public static OrderSummaryDto ToSummary(this Order order) => new(
    OrderId: order.Id.Value.ToString(),
    CustomerName: order.Customer.FullName,
    ItemCount: order.Items.Count,
    Total: order.Items.Sum(i => i.Quantity * i.UnitPrice),
    Status: order.Status switch
    {
        OrderStatus.Pending => "Awaiting Payment",
        OrderStatus.Paid => "Processing",
        OrderStatus.Shipped => "On the Way",
        OrderStatus.Delivered => "Completed",
        _ => "Unknown"
    });
```

## Result Type Pattern

Use `Result<T, TError>` for expected errors. Exceptions for unexpected/system errors only.

```csharp
public readonly record struct Result<TValue, TError>
{
    private readonly TValue? _value;
    private readonly TError? _error;
    private readonly bool _isSuccess;

    private Result(TValue value) { _value = value; _error = default; _isSuccess = true; }
    private Result(TError error) { _value = default; _error = error; _isSuccess = false; }

    public bool IsSuccess => _isSuccess;
    public bool IsFailure => !_isSuccess;
    public TValue Value => _isSuccess ? _value! : throw new InvalidOperationException("Cannot access Value of a failed result");
    public TError Error => !_isSuccess ? _error! : throw new InvalidOperationException("Cannot access Error of a successful result");

    public static Result<TValue, TError> Success(TValue value) => new(value);
    public static Result<TValue, TError> Failure(TError error) => new(error);

    public Result<TOut, TError> Map<TOut>(Func<TValue, TOut> mapper)
        => _isSuccess ? Result<TOut, TError>.Success(mapper(_value!)) : Result<TOut, TError>.Failure(_error!);

    public Result<TOut, TError> Bind<TOut>(Func<TValue, Result<TOut, TError>> binder)
        => _isSuccess ? binder(_value!) : Result<TOut, TError>.Failure(_error!);

    public TResult Match<TResult>(Func<TValue, TResult> onSuccess, Func<TError, TResult> onFailure)
        => _isSuccess ? onSuccess(_value!) : onFailure(_error!);
}

public readonly record struct OrderError(string Code, string Message);
```

Usage:

```csharp
public async Task<Result<Order, OrderError>> CreateOrderAsync(
    CreateOrderRequest request, CancellationToken ct)
{
    var validation = ValidateRequest(request);
    if (validation.IsFailure)
        return Result<Order, OrderError>.Failure(validation.Error);

    var order = new Order(OrderId.New(), new CustomerId(request.CustomerId), request.Items);
    await _repository.SaveAsync(order, ct);
    return Result<Order, OrderError>.Success(order);
}

// Map to HTTP response
public IActionResult MapToActionResult(Result<Order, OrderError> result) =>
    result.Match(
        onSuccess: order => new OkObjectResult(order),
        onFailure: error => error.Code switch
        {
            "VALIDATION_ERROR" => new BadRequestObjectResult(error.Message),
            "NOT_FOUND" => new NotFoundObjectResult(error.Message),
            _ => new ObjectResult(error.Message) { StatusCode = 500 }
        });
```

## Span<T> and Memory<T>

`Span<T>` for synchronous zero-allocation work. `Memory<T>` for async (Span can't cross await). `ArrayPool<T>` for large temporary buffers.

```csharp
// Zero-allocation parsing
public int ParseOrderId(ReadOnlySpan<char> input)
{
    if (!input.StartsWith("ORD-"))
        throw new FormatException("Invalid order ID format");
    return int.Parse(input.Slice(4));
}

// stackalloc for small buffers
public void FormatMessage()
{
    Span<char> buffer = stackalloc char[256];
    var written = FormatInto(buffer);
    var message = new string(buffer.Slice(0, written));
}

// ArrayPool for large temporary buffers
public async Task ProcessLargeFileAsync(Stream stream, CancellationToken ct)
{
    var buffer = ArrayPool<byte>.Shared.Rent(8192);
    try
    {
        int bytesRead;
        while ((bytesRead = await stream.ReadAsync(buffer.AsMemory(), ct)) > 0)
            ProcessChunk(buffer.AsSpan(0, bytesRead));
    }
    finally
    {
        ArrayPool<byte>.Shared.Return(buffer);
    }
}

// Hybrid: stackalloc for small, rent for large
static short GenerateHashCode(string? key)
{
    if (key is null) return 0;
    const int StackLimit = 256;
    var max = Encoding.UTF8.GetMaxByteCount(key.Length);

    byte[]? rented = null;
    Span<byte> buf = max <= StackLimit
        ? stackalloc byte[StackLimit]
        : (rented = ArrayPool<byte>.Shared.Rent(max));
    try
    {
        var written = Encoding.UTF8.GetBytes(key.AsSpan(), buf);
        ComputeHash(buf[..written], out var h1, out var h2);
        return unchecked((short)(h1 ^ h2));
    }
    finally
    {
        if (rented is not null) ArrayPool<byte>.Shared.Return(rented);
    }
}

// TryFormat pattern
public bool TryFormatOrderId(int orderId, Span<char> destination, out int charsWritten)
{
    const string prefix = "ORD-";
    if (destination.Length < prefix.Length + 10) { charsWritten = 0; return false; }
    prefix.AsSpan().CopyTo(destination);
    var ok = orderId.TryFormat(destination.Slice(prefix.Length), out var n);
    charsWritten = prefix.Length + n;
    return ok;
}
```

| Type | Use Case |
|------|----------|
| `Span<T>` / `ReadOnlySpan<T>` | Synchronous slicing, parsing, stack buffers |
| `Memory<T>` / `ReadOnlyMemory<T>` | Async operations (can't use Span across await) |
| `ArrayPool<T>` | Large temporary buffers (>1KB) |

## API Design: Accept Abstractions, Return Specific

```csharp
// Accept IEnumerable<T> if you only iterate once
public decimal CalculateTotal(IEnumerable<OrderItem> items) => items.Sum(i => i.Price * i.Quantity);

// Accept IReadOnlyList<T> if you need indexing
public OrderItem GetMiddleItem(IReadOnlyList<OrderItem> items) => items[items.Count / 2];

// Accept ReadOnlySpan<T> for zero-allocation hot paths
public int Sum(ReadOnlySpan<int> numbers) { int t = 0; foreach (var n in numbers) t += n; return t; }

// Return IReadOnlyList<T> for materialized collections
public IReadOnlyList<Order> GetOrders(string customerId) => _repo.Query()
    .Where(o => o.CustomerId == customerId).ToList();

// Return IAsyncEnumerable<T> for streaming
public async IAsyncEnumerable<Order> StreamOrdersAsync(
    string customerId, [EnumeratorCancellation] CancellationToken ct = default)
{
    await foreach (var order in _repo.StreamAllAsync(ct))
        if (order.CustomerId == customerId) yield return order;
}
```

## UnsafeAccessorAttribute (.NET 8+)

When you genuinely need private member access (serializers, test helpers), use `UnsafeAccessor` instead of reflection. Zero overhead, AOT-compatible.

```csharp
// ❌ Reflection — slow, allocates, breaks AOT
var field = typeof(Order).GetField("_status", BindingFlags.NonPublic | BindingFlags.Instance);
var status = (OrderStatus)field!.GetValue(order)!;

// ✅ UnsafeAccessor — zero overhead
[UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_status")]
static extern ref OrderStatus GetStatusField(Order order);

var status = GetStatusField(order);
```
