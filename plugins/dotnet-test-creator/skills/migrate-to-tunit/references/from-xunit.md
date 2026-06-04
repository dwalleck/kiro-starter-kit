# Migrating from xUnit to TUnit

## Attribute and API mapping

| xUnit | TUnit |
|---|---|
| `[Fact]` | `[Test]` |
| `[Theory]` | `[Test]` (no separate "theory" attribute — `[Test]` works for parameterized tests too) |
| `[InlineData(...)]` | `[Arguments(...)]` |
| `[MemberData(nameof(Source))]` | `[MethodDataSource(nameof(Source))]` |
| `[ClassData(typeof(MyData))]` | `[MethodDataSource(typeof(MyData), nameof(MyData.Method))]` (rewrite the data class to expose a static method) |
| `[Trait("key", "value")]` | `[Property("key", "value")]` |
| `IClassFixture<T>` | `[ClassDataSource<T>(Shared = SharedType.PerClass)]` |
| `ICollectionFixture<T>` + `[Collection("name")]` | `[ClassDataSource<T>(Shared = SharedType.Keyed, Key = "name")]` |
| Constructor (per-test setup) | Constructor or `[Before(Test)]` |
| `IDisposable.Dispose` | `IDisposable.Dispose` or `[After(Test)]` |
| `IAsyncLifetime.InitializeAsync` / `DisposeAsync` | `[Before(Test)]` / `[After(Test)]` (both can be `async Task`) |
| `ITestOutputHelper` (constructor parameter) | `TestContext` parameter on the test method |
| `Assert.Equal(expected, actual)` | `await Assert.That(actual).IsEqualTo(expected)` |
| `Assert.Equal(expected, actual, comparer)` | `await Assert.That(actual).IsEqualTo(expected).Using(comparer)` |
| `Assert.NotNull(value)` | `await Assert.That(value).IsNotNull()` |
| `Assert.True(condition)` / `Assert.False(condition)` | `await Assert.That(condition).IsTrue()` / `IsFalse()` |
| `Assert.Throws<T>(() => ...)` | `await Assert.That(() => ...).Throws<T>()` |
| `Assert.ThrowsAsync<T>(async () => ...)` | `await Assert.That(async () => ...).Throws<T>()` |
| `Assert.Contains(expected, collection)` | `await Assert.That(collection).Contains(expected)` |
| `Assert.Empty(collection)` / `Assert.NotEmpty(collection)` | `await Assert.That(collection).IsEmpty()` / `IsNotEmpty()` |
| `Assert.IsType<T>(value)` | `await Assert.That(value).IsTypeOf<T>()` |
| `Assert.IsAssignableFrom<T>(value)` | `await Assert.That(value).IsAssignableTo<T>()` |
| `[Skip = "reason"]` on `[Fact]` / `[Theory]` | `[Skip("reason")]` on the test method |

## Worked examples

### Basic test

**Before — xUnit:**

```csharp
using Xunit;

public class CalculatorTests
{
    [Fact]
    public void Add_TwoNumbers_ReturnsSum()
    {
        var calculator = new Calculator();
        var result = calculator.Add(2, 3);
        Assert.Equal(5, result);
    }
}
```

**After — TUnit:**

```csharp
using TUnit.Assertions;
using TUnit.Assertions.Extensions;
using TUnit.Core;

public class CalculatorTests
{
    [Test]
    public async Task Add_TwoNumbers_ReturnsSum()
    {
        var calculator = new Calculator();
        var result = calculator.Add(2, 3);
        await Assert.That(result).IsEqualTo(5);
    }
}
```

### Theory with `[InlineData]`

**Before:**

```csharp
[Theory]
[InlineData("hello", 5)]
[InlineData("world", 5)]
[InlineData("", 0)]
public void Length_ReturnsCorrectValue(string input, int expectedLength)
{
    Assert.Equal(expectedLength, input.Length);
}
```

**After:**

```csharp
[Test]
[Arguments("hello", 5)]
[Arguments("world", 5)]
[Arguments("", 0)]
public async Task Length_ReturnsCorrectValue(string input, int expectedLength)
{
    await Assert.That(input.Length).IsEqualTo(expectedLength);
}
```

### `[MemberData]` → `[MethodDataSource]`

**Before:**

```csharp
public static IEnumerable<object[]> AdditionData =>
    new[] { new object[] { 1, 2, 3 }, new object[] { 5, 5, 10 } };

[Theory]
[MemberData(nameof(AdditionData))]
public void Add(int a, int b, int expected)
{
    Assert.Equal(expected, Calculator.Add(a, b));
}
```

**After:**

```csharp
public static IEnumerable<Func<(int, int, int)>> AdditionData()
{
    yield return () => (1, 2, 3);
    yield return () => (5, 5, 10);
}

[Test]
[MethodDataSource(nameof(AdditionData))]
public async Task Add(int a, int b, int expected)
{
    await Assert.That(Calculator.Add(a, b)).IsEqualTo(expected);
}
```

Note the shift from `IEnumerable<object[]>` to `IEnumerable<Func<(...)>>` — TUnit's signature pattern wraps each row in a `Func` so each test gets a fresh instance (preventing state bleed between rows).

### `IClassFixture<T>` → `[ClassDataSource<T>]`

**Before:**

```csharp
public class DatabaseFixture : IDisposable
{
    public DbConnection Connection { get; }
    public DatabaseFixture() { Connection = new DbConnection(); Connection.Open(); }
    public void Dispose() => Connection.Dispose();
}

public class UserRepositoryTests : IClassFixture<DatabaseFixture>
{
    private readonly DatabaseFixture _fixture;
    public UserRepositoryTests(DatabaseFixture fixture) => _fixture = fixture;

    [Fact]
    public void GetUser_ReturnsUser()
    {
        var repo = new UserRepository(_fixture.Connection);
        var user = repo.GetUser(1);
        Assert.NotNull(user);
    }
}
```

**After:**

```csharp
public sealed class DatabaseFixture : IAsyncInitializer, IAsyncDisposable
{
    public DbConnection Connection { get; private set; } = null!;
    public async Task InitializeAsync()
    {
        Connection = new DbConnection();
        await Connection.OpenAsync();
    }
    public async ValueTask DisposeAsync() => await Connection.DisposeAsync();
}

[ClassDataSource<DatabaseFixture>(Shared = SharedType.PerClass)]
public class UserRepositoryTests(DatabaseFixture fixture)
{
    [Test]
    public async Task GetUser_ReturnsUser()
    {
        var repo = new UserRepository(fixture.Connection);
        var user = repo.GetUser(1);
        await Assert.That(user).IsNotNull();
    }
}
```

The lifetime is the same (one fixture per test class). `IAsyncInitializer` / `IAsyncDisposable` replace constructor / `Dispose` for async setup.

### `IAsyncLifetime` → `[Before(Test)]` / `[After(Test)]`

**Before:**

```csharp
public class ServiceTests : IAsyncLifetime
{
    private MyService _service = null!;
    public async Task InitializeAsync() { _service = await CreateAsync(); }
    public async Task DisposeAsync() => await _service.DisposeAsync();

    [Fact]
    public async Task DoesWork() { /* ... */ }
}
```

**After:**

```csharp
public class ServiceTests
{
    private MyService _service = null!;

    [Before(Test)]
    public async Task SetUp() { _service = await CreateAsync(); }

    [After(Test)]
    public async Task TearDown() => await _service.DisposeAsync();

    [Test]
    public async Task DoesWork() { /* ... */ }
}
```

### `ITestOutputHelper` → `TestContext`

**Before:**

```csharp
public class LoggingTests
{
    private readonly ITestOutputHelper _output;
    public LoggingTests(ITestOutputHelper output) => _output = output;

    [Fact]
    public void Test() => _output.WriteLine("hello");
}
```

**After:**

```csharp
public class LoggingTests
{
    [Test]
    public async Task Test(TestContext context)
    {
        context.OutputWriter.WriteLine("hello");
        await Task.CompletedTask;
    }
}
```

## xUnit-specific pitfalls during migration

| Pitfall | Solution |
|---|---|
| Mass-renaming `[Theory]` → `[Test]` and forgetting that `[InlineData]` → `[Arguments]` is a separate rename | Run both renames as a pair. A test method with `[Test]` plus a leftover `[InlineData(...)]` will not see the data — TUnit ignores attributes it doesn't recognise. |
| `Assert.ThrowsAsync<T>(async () => ...)` carried over verbatim | Rewrite as `await Assert.That(async () => ...).Throws<T>()`. xUnit's `ThrowsAsync` is its own method; in TUnit, sync and async exception assertions share one shape with different lambda types. |
| `IClassFixture<T>` test base classes that *also* have constructor params | TUnit primary-constructor syntax handles this cleanly: `public class Tests(MyFixture f) { ... }`. Keep the `[ClassDataSource<MyFixture>(...)]` on the class. |
| `[CollectionDefinition]` / `[Collection]` with `ICollectionFixture<T>` for cross-class fixture sharing | Map to `[ClassDataSource<T>(Shared = SharedType.Keyed, Key = "name")]` on each participating class — the matching `Key` ties them together. |
| `ITestOutputHelper.WriteLine` calls scattered through tests | The migration is mechanical (`_output.WriteLine` → `context.OutputWriter.WriteLine`), but you must add `TestContext context` as a parameter to every affected test method. |
| Test counts dropping after migration | Usually means a `[Theory]` had its attribute renamed but `[InlineData]` rows weren't. Build with the analyzers on and check warnings before running. |
