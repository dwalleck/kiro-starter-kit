# Migrating from MSTest to TUnit

## Attribute and API mapping

| MSTest | TUnit |
|---|---|
| `[TestClass]` | _Remove_ — TUnit doesn't need it |
| `[TestMethod]` | `[Test]` |
| `[DataRow(...)]` | `[Arguments(...)]` |
| `[DynamicData(nameof(Source), DynamicDataSourceType.Method)]` | `[MethodDataSource(nameof(Source))]` |
| `[DynamicData(nameof(Source), DynamicDataSourceType.Property)]` | Refactor source into a method, then `[MethodDataSource(nameof(Source))]` |
| `[TestInitialize]` | `[Before(Test)]` |
| `[TestCleanup]` | `[After(Test)]` |
| `[ClassInitialize]` | `[Before(Class)]` _(remove the `TestContext` parameter)_ |
| `[ClassCleanup]` | `[After(Class)]` |
| `[AssemblyInitialize]` | `[Before(Assembly)]` _(remove the `TestContext` parameter)_ |
| `[AssemblyCleanup]` | `[After(Assembly)]` |
| `[TestCategory("value")]` | `[Property("Category", "value")]` |
| `[Ignore]` / `[Ignore("reason")]` | `[Skip]` / `[Skip("reason")]` |
| `[Owner("name")]` | `[Property("Owner", "name")]` |
| `[Priority(n)]` | `[Property("Priority", "n")]` |
| `[Timeout(ms)]` | `[Timeout(ms)]` |
| `[DoNotParallelize]` | `[NotInParallel("ClassConstraint")]` (with a constraint key) |
| `[assembly: Parallelize(Workers = N, Scope = ExecutionScope.MethodLevel)]` | _Default behaviour_ — TUnit parallelizes by default |
| `TestContext` (property or constructor parameter) | `TestContext` parameter on the test method |
| `Assert.AreEqual(expected, actual)` | `await Assert.That(actual).IsEqualTo(expected)` |
| `Assert.AreNotEqual(notExpected, actual)` | `await Assert.That(actual).IsNotEqualTo(notExpected)` |
| `Assert.IsNull(value)` / `IsNotNull(value)` | `await Assert.That(value).IsNull()` / `.IsNotNull()` |
| `Assert.IsTrue(condition)` / `IsFalse(condition)` | `await Assert.That(condition).IsTrue()` / `.IsFalse()` |
| `Assert.ThrowsExactly<T>(() => ...)` (MSTest 3.8+) | `await Assert.That(() => ...).ThrowsExactly<T>()` |
| `Assert.Throws<T>(() => ...)` | `await Assert.That(() => ...).Throws<T>()` |
| `Assert.ThrowsAsync<T>(async () => ...)` | `await Assert.That(async () => ...).Throws<T>()` |
| `Assert.IsInstanceOfType<T>(obj)` | `await Assert.That(obj).IsTypeOf<T>()` |
| `Assert.Contains(item, collection)` | `await Assert.That(collection).Contains(item)` |
| `Assert.HasCount(n, collection)` | `await Assert.That(collection).HasCount(n)` |
| `CollectionAssert.AreEqual(expected, actual)` | `await Assert.That(actual).IsEquivalentTo(expected)` |
| `StringAssert.Contains(text, sub)` | `await Assert.That(text).Contains(sub)` |
| `Assert.Inconclusive("reason")` | `Skip.Test("reason")` |

## Project-file change for `MSTest.Sdk` users

If the project used `<Project Sdk="MSTest.Sdk">`, switch back to the standard SDK and add the TUnit package:

**Before:**

```xml
<Project Sdk="MSTest.Sdk">
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
  </PropertyGroup>
</Project>
```

**After:**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <OutputType>Exe</OutputType>
    <IsPackable>false</IsPackable>
    <LangVersion>latest</LangVersion>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="TUnit" Version="*" />
  </ItemGroup>
</Project>
```

Also remove any `MSTest.Sdk` reference from `global.json` if one was added there per repo convention.

## Worked examples

### Basic test — drop `[TestClass]`

**Before — MSTest:**

```csharp
using Microsoft.VisualStudio.TestTools.UnitTesting;

[TestClass]
public class OrderTests
{
    [TestMethod]
    public void CreateOrder_ValidData_Succeeds()
    {
        var actual = OrderService.Create("widget");
        Assert.AreEqual("widget", actual.ProductName);
        Assert.IsTrue(actual.IsValid);
    }
}
```

**After — TUnit:**

```csharp
using TUnit.Assertions;
using TUnit.Assertions.Extensions;
using TUnit.Core;

public class OrderTests
{
    [Test]
    public async Task CreateOrder_ValidData_Succeeds()
    {
        var actual = OrderService.Create("widget");
        await Assert.That(actual.ProductName).IsEqualTo("widget");
        await Assert.That(actual.IsValid).IsTrue();
    }
}
```

The argument order in `Assert.AreEqual(expected, actual)` flips into `Assert.That(actual).IsEqualTo(expected)` — the actual value is the *subject* of the assertion in TUnit.

### `[DataRow]` → `[Arguments]`

**Before:**

```csharp
[TestMethod]
[DataRow(1, 2, 3)]
[DataRow(10, 20, 30)]
public void AdditionTest(int a, int b, int expected)
{
    Assert.AreEqual(expected, a + b);
}
```

**After:**

```csharp
[Test]
[Arguments(1, 2, 3)]
[Arguments(10, 20, 30)]
public async Task AdditionTest(int a, int b, int expected)
{
    await Assert.That(a + b).IsEqualTo(expected);
}
```

### `[DynamicData]` → `[MethodDataSource]`

**Before:**

```csharp
[TestMethod]
[DynamicData(nameof(TestData), DynamicDataSourceType.Method)]
public void TestMethod(int value, string text)
{
    Assert.IsNotNull(value);
}

private static IEnumerable<object[]> TestData()
{
    yield return new object[] { 1, "one" };
    yield return new object[] { 2, "two" };
}
```

**After:**

```csharp
[Test]
[MethodDataSource(nameof(TestData))]
public async Task TestMethod(int value, string text)
{
    await Assert.That(value).IsNotDefault();
}

private static IEnumerable<Func<(int, string)>> TestData()
{
    yield return () => (1, "one");
    yield return () => (2, "two");
}
```

The shape changes from `IEnumerable<object[]>` to `IEnumerable<Func<(...)>>`. Tuple types replace `object[]` for type safety, and each row is wrapped in `Func<...>` so every test gets a fresh instance.

### Lifecycle methods

**Before:**

```csharp
[TestClass]
public class IntegrationTests
{
    private static Database _database = null!;
    private OrderService _service = null!;

    [ClassInitialize]
    public static void ClassInit(TestContext context)
    {
        _database = new Database();
        _database.Initialize();
    }

    [TestInitialize]
    public void TestInit()
    {
        _service = new OrderService(_database);
    }

    [TestCleanup]
    public void TestCleanup() => _service?.Dispose();

    [ClassCleanup]
    public static void ClassCleanup() => _database?.Dispose();
}
```

**After:**

```csharp
public class IntegrationTests
{
    private static Database _database = null!;
    private OrderService _service = null!;

    [Before(Class)]
    public static async Task ClassInit()
    {
        _database = new Database();
        _database.Initialize();
        await Task.CompletedTask;
    }

    [Before(Test)]
    public async Task TestInit()
    {
        _service = new OrderService(_database);
        await Task.CompletedTask;
    }

    [After(Test)]
    public void TestCleanup() => _service?.Dispose();

    [After(Class)]
    public static void ClassCleanup() => _database?.Dispose();
}
```

Two subtle changes:

1. `[Before(Class)]` does not receive a `TestContext` parameter. Drop it.
2. The class-level setup/cleanup methods are still required to be **static** (same as `[ClassInitialize]` / `[ClassCleanup]`). Test-level setup is instance.

### `TestContext` injection

**Before:**

```csharp
[TestClass]
public class LoggingTests
{
    public TestContext TestContext { get; set; } = null!;

    [TestMethod]
    public void Test()
    {
        TestContext.WriteLine("hello");
    }
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

Drop the property; accept `TestContext` as a parameter on the methods that need it. The output API differs (`OutputWriter.WriteLine`).

### Async exception assertion

**Before — MSTest 3.x:**

```csharp
[TestMethod]
public async Task Process_NullInput_Throws()
{
    var ex = await Assert.ThrowsExactlyAsync<ArgumentNullException>(
        async () => await service.ProcessAsync(null));
    Assert.AreEqual("input", ex.ParamName);
}
```

**After — TUnit:**

```csharp
[Test]
public async Task Process_NullInput_Throws()
{
    var ex = await Assert.That(async () => await service.ProcessAsync(null!))
        .ThrowsExactly<ArgumentNullException>();
    await Assert.That(ex.ParamName).IsEqualTo("input");
}
```

The exception object is returned from `.Throws<T>()` / `.ThrowsExactly<T>()` so you can chain assertions against it.

## MSTest-specific pitfalls during migration

| Pitfall | Solution |
|---|---|
| `Assert.AreEqual(expected, actual)` argument order swapped during migration | TUnit puts the actual value in `Assert.That(actual).IsEqualTo(expected)` — the subject of the assertion is the actual value. Don't reverse the meaning. |
| `[ClassInitialize(InheritanceBehavior.BeforeEachDerivedClass)]` | Use `[BeforeEvery(Class)]` for "run before every class in the assembly," or restructure to a base class with `[Before(Class)]`. |
| `[DataTestMethod]` (legacy MSTest) | Same as `[TestMethod]` for migration purposes — both become `[Test]`. |
| Sealed test class kept after migration | Recommended — TUnit test classes can also be `sealed` for the same JIT/perf benefits. Optional but advised. |
| `TestContext` property on the class still set after migration | Remove the property and any `TestContext = null!;` initialiser. Accept `TestContext` as a parameter on the methods that need it. |
| `Assert.Inconclusive("reason")` is now treated as a test failure | Use `Skip.Test("reason")` (executable form) or `[Skip("reason")]` (declarative form). |
| MSTest tests previously ran sequentially within a class — fail after migration | MSTest defaults to method-level parallelization but with a single test class instance shared across method invocations within a class. TUnit defaults to fully parallel and a fresh instance per test. Add `[NotInParallel("MyKey")]` for tests that share resources, or refactor instance state into `[Before(Test)]` setup. |
| `[ExpectedException(typeof(T))]` (legacy MSTest) | Convert to `await Assert.That(() => ...).Throws<T>()` — `[ExpectedException]` doesn't exist in TUnit. |
| `[Owner]` / `[Priority]` filters used in CI test selection | These become `[Property("Owner", "...")]` and `[Property("Priority", "...")]`. Update the filter expression: `--filter "Property[Owner]=alice"`. |
