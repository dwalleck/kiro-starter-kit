# Migrating from NUnit to TUnit

## Attribute and API mapping

| NUnit | TUnit |
|---|---|
| `[TestFixture]` | _Remove_ — TUnit doesn't use a class-level marker |
| `[Test]` | `[Test]` |
| `[TestCase(...)]` | `[Arguments(...)]` |
| `[TestCaseSource(nameof(Source))]` | `[MethodDataSource(nameof(Source))]` |
| `[Values(...)]` (parameter-level) | `[Matrix(...)]` (parameter-level) on a method with `[MatrixDataSource]` |
| `[ValueSource(nameof(Source))]` | `[MatrixDataSource]` + custom data-source generator |
| `[SetUp]` | `[Before(Test)]` |
| `[TearDown]` | `[After(Test)]` |
| `[OneTimeSetUp]` | `[Before(Class)]` (must be `static`) |
| `[OneTimeTearDown]` | `[After(Class)]` (must be `static`) |
| `[SetUpFixture]` | `[Before(Assembly)]` / `[After(Assembly)]` on a static class |
| `[Category("value")]` | `[Property("Category", "value")]` |
| `[Ignore("reason")]` | `[Skip("reason")]` |
| `[Explicit]` | `[Explicit]` |
| `[Order(n)]` | `[NotInParallel(Order = n)]` (ordering only meaningful within a non-parallel constraint group) |
| `[Parallelizable]` / `[NonParallelizable]` | _Default is parallel_; opt out with `[NotInParallel(...)]` per test or `[assembly: NotInParallel]` globally |
| `Assert.That(actual, Is.EqualTo(expected))` | `await Assert.That(actual).IsEqualTo(expected)` |
| `Assert.That(actual, Is.Not.EqualTo(other))` | `await Assert.That(actual).IsNotEqualTo(other)` |
| `Assert.That(value, Is.Null)` / `Is.Not.Null` | `await Assert.That(value).IsNull()` / `.IsNotNull()` |
| `Assert.That(condition, Is.True)` | `await Assert.That(condition).IsTrue()` |
| `Assert.That(() => ..., Throws.TypeOf<T>())` | `await Assert.That(() => ...).Throws<T>()` |
| `Assert.That(collection, Has.Count.EqualTo(3))` | `await Assert.That(collection).HasCount(3)` |
| `Assert.That(collection, Does.Contain(item))` | `await Assert.That(collection).Contains(item)` |
| `CollectionAssert.AreEqual(expected, actual)` | `await Assert.That(actual).IsEquivalentTo(expected)` |
| `Assert.Multiple(() => { ... })` | Use `.And.` chaining on a single `Assert.That(...)`, or split into separate awaited assertions |

## Assertion shape change

NUnit's `Assert.That(value, constraint)` and TUnit's `Assert.That(value).Method(arg)` look superficially similar but differ in two material ways:

1. **TUnit assertions are awaited.** Every assertion becomes `await Assert.That(...)`.
2. **TUnit chains methods, not constraint objects.** `Is.EqualTo(x)` becomes `.IsEqualTo(x)`. `Is.Not.EqualTo(x)` becomes `.IsNotEqualTo(x)`. `Has.Count.EqualTo(3)` becomes `.HasCount(3)`.

## Worked examples

### Basic test — drop `[TestFixture]`

**Before — NUnit:**

```csharp
using NUnit.Framework;

[TestFixture]
public class CalculatorTests
{
    [Test]
    public void Add()
    {
        Assert.That(2 + 3, Is.EqualTo(5));
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
    public async Task Add()
    {
        await Assert.That(2 + 3).IsEqualTo(5);
    }
}
```

`[TestFixture]` is removed entirely — TUnit discovers test classes by the presence of `[Test]` methods.

### `[TestCase]` → `[Arguments]`

**Before:**

```csharp
[TestCase(1, 2, 3)]
[TestCase(2, 2, 4)]
[TestCase(5, 5, 10)]
public void Add(int a, int b, int expected)
{
    Assert.That(a + b, Is.EqualTo(expected));
}
```

**After:**

```csharp
[Test]
[Arguments(1, 2, 3)]
[Arguments(2, 2, 4)]
[Arguments(5, 5, 10)]
public async Task Add(int a, int b, int expected)
{
    await Assert.That(a + b).IsEqualTo(expected);
}
```

Note: `[Test]` is required in TUnit even with `[Arguments]` — NUnit's `[TestCase]` implies `[Test]`, but TUnit's `[Arguments]` is a data attribute, not a test marker.

### `[TestCaseSource]` → `[MethodDataSource]`

**Before:**

```csharp
public static IEnumerable<TestCaseData> AdditionCases()
{
    yield return new TestCaseData(1, 2, 3);
    yield return new TestCaseData(2, 2, 4);
}

[TestCaseSource(nameof(AdditionCases))]
public void Add(int a, int b, int expected)
{
    Assert.That(a + b, Is.EqualTo(expected));
}
```

**After:**

```csharp
public static IEnumerable<Func<(int, int, int)>> AdditionCases()
{
    yield return () => (1, 2, 3);
    yield return () => (2, 2, 4);
}

[Test]
[MethodDataSource(nameof(AdditionCases))]
public async Task Add(int a, int b, int expected)
{
    await Assert.That(a + b).IsEqualTo(expected);
}
```

Note: each row is wrapped in `Func<...>` so every test gets a fresh instance — TUnit's standard pattern.

### Setup / teardown

**Before:**

```csharp
[TestFixture]
public class DatabaseTests
{
    private DbConnection _conn = null!;

    [OneTimeSetUp]
    public void OneTimeInit() => SeedDatabase();

    [SetUp]
    public void Init() => _conn = new DbConnection();

    [TearDown]
    public void Cleanup() => _conn.Dispose();

    [OneTimeTearDown]
    public void OneTimeCleanup() => CleanDatabase();
}
```

**After:**

```csharp
public class DatabaseTests
{
    private DbConnection _conn = null!;

    [Before(Class)]
    public static async Task OneTimeInit()
    {
        SeedDatabase();
        await Task.CompletedTask;
    }

    [Before(Test)]
    public async Task Init()
    {
        _conn = new DbConnection();
        await Task.CompletedTask;
    }

    [After(Test)]
    public void Cleanup() => _conn.Dispose();

    [After(Class)]
    public static void OneTimeCleanup() => CleanDatabase();
}
```

`[Before(Class)]` and `[After(Class)]` require **static** methods — `[OneTimeSetUp]` did not, so this is a real shape change. If your one-time setup needed to write to instance fields, refactor it to write to static fields, or move it into a `[ClassDataSource<T>]` fixture.

### `Assert.Multiple` → chained assertions

**Before:**

```csharp
Assert.Multiple(() =>
{
    Assert.That(user.Name, Is.EqualTo("Alice"));
    Assert.That(user.Email, Is.EqualTo("alice@example.com"));
    Assert.That(user.Age, Is.GreaterThan(0));
});
```

**After (option 1 — chain with `.And`):**

```csharp
await Assert.That(user)
    .HasMember(u => u.Name).EqualTo("Alice")
    .And.HasMember(u => u.Email).EqualTo("alice@example.com")
    .And.HasMember(u => u.Age).GreaterThan(0);
```

**After (option 2 — separate assertions):**

```csharp
await Assert.That(user.Name).IsEqualTo("Alice");
await Assert.That(user.Email).IsEqualTo("alice@example.com");
await Assert.That(user.Age).IsGreaterThan(0);
```

Option 2 is simpler; option 1 collects all member failures into a single message. Pick by readability.

## NUnit-specific pitfalls during migration

| Pitfall | Solution |
|---|---|
| Test count drops because `[TestCase]` implied `[Test]` but `[Arguments]` does not | Add `[Test]` to every method that has `[Arguments]`. |
| `[OneTimeSetUp]` was an instance method writing to instance fields | `[Before(Class)]` is static. Move shared state to static fields or use `[ClassDataSource<T>(Shared = SharedType.PerClass)]` for a typed fixture. |
| Tests previously ran sequentially within a fixture — fail intermittently after migration | NUnit defaults to one instance per fixture, sequential. TUnit defaults to parallel and a new instance per test. Add `[NotInParallel("ConstraintKey")]` if tests share resources, or refactor to be independent. |
| `Assert.That(x, Is.EqualTo(y))` translated mechanically to `await Assert.That(x).Is.EqualTo(y)` | The fluent shape is `.IsEqualTo(y)`, not `.Is.EqualTo(y)`. Same for `.IsNotEqualTo`, `.IsNull`, etc. |
| `[Order(n)]` carried over expecting deterministic ordering | TUnit ordering is determined by parallel-constraint groups. Use `[NotInParallel(Order = n)]`, but only within tests that share a constraint key. Don't rely on global ordering. |
| `Assert.Throws<T>(() => ...)` (synchronous return-value form) | NUnit's static `Assert.Throws<T>` returns the exception; TUnit's awaited form does too: `var ex = await Assert.That(() => ...).Throws<T>();`. The mechanical change is wrapping in `Assert.That(...)`. |
| `[ValueSource]` / `[Random]` / combinatorial attributes | Migrate to `[MatrixDataSource]` + `[Matrix(...)]` parameter attributes for combinatorial coverage; otherwise materialise the values into a `[MethodDataSource]`. |
