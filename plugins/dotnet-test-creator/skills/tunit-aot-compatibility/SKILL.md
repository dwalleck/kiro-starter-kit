---
name: tunit-aot-compatibility
description: "Make TUnit test projects work under NativeAOT, IL trimming, and single-file publishing. Use when the user is publishing a TUnit test project with PublishAot=true, hits TUnit0058 errors about generic tests, sees IL2026/IL3050 trim warnings on test data sources, asks about [GenerateGenericTest], or needs to combine [ClassConstructor<T>] with the trimmer's DynamicallyAccessedMembers requirements. Also use when the user asks how to keep custom IClassConstructor or DataSourceGenerator implementations AOT-safe, or what restrictions apply to data sources under AOT (no reflection-based generators, static methods only)."
---

# AOT-Compatible TUnit Tests

Help users keep TUnit test projects compatible with NativeAOT, IL trimming, and single-file publishing.

TUnit's runtime engine is AOT-compatible by design — it uses source generators rather than reflection. The constraints in this skill are about test code the user writes, not about TUnit itself.

## When to Use

- User is publishing a test project with `<PublishAot>true</PublishAot>`
- User sees `TUnit0058` (generic test without `[GenerateGenericTest]`) or trim warnings (`IL2026`, `IL3050`) in a TUnit project
- User asks how to write AOT-compatible custom `IClassConstructor` / `DataSourceGenerator`
- User asks why a particular reflection-based data source pattern doesn't work under AOT

## When Not to Use

- User is writing standard TUnit tests without AOT publishing concerns (use `writing-tunit-tests`)
- User is publishing the application under test for AOT — that's a separate concern from the test project
- User is debugging a runtime crash under AOT that's not test-framework-related (general .NET AOT troubleshooting)

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| Test project file | Yes | The `.csproj` being published |
| Specific error or warning | No | If known (e.g. `TUnit0058`, `IL2026`) |
| Custom data source / class constructor | No | Any custom extensibility code that may need AOT annotations |

## Workflow

### Step 1: Configure the project for AOT publishing

Set the standard .NET AOT properties on the test project:

```xml
<PropertyGroup>
  <OutputType>Exe</OutputType>
  <TargetFramework>net9.0</TargetFramework>
  <PublishAot>true</PublishAot>
  <IsAotCompatible>true</IsAotCompatible>
  <IsTrimmable>true</IsTrimmable>
  <LangVersion>latest</LangVersion>
</PropertyGroup>
```

`IsAotCompatible=true` is the important one for surfacing problems early — it enables the analyzers that emit `IL2026` (use of reflection-requiring API) and `IL3050` (unsafe-for-AOT API). Without it, the project may build but fail mysteriously after `dotnet publish -c Release -r linux-x64`.

Run a publish to validate:

```bash
dotnet publish tests/MyProject.Tests/ -c Release -r linux-x64
./tests/MyProject.Tests/bin/Release/net9.0/linux-x64/publish/MyProject.Tests --filter "FullyQualifiedName~Smoke"
```

### Step 2: Annotate generic tests with `[GenerateGenericTest]`

Generic test methods and generic test classes can't be discovered at runtime under AOT — the type substitutions must be known at compile time. TUnit emits `TUnit0058` if a generic test has no `[GenerateGenericTest]` annotation.

#### Generic test method

```csharp
[Test]
[GenerateGenericTest(typeof(int), typeof(string))]
[GenerateGenericTest(typeof(long), typeof(bool))]
public async Task GenericTest<T1, T2>()
{
    var v1 = default(T1);
    var v2 = default(T2);
    await Assert.That(v1).IsEqualTo(default(T1));
    await Assert.That(v2).IsEqualTo(default(T2));
}
```

Each `[GenerateGenericTest]` produces one concrete test instantiation at compile time.

#### Generic test class

```csharp
[GenerateGenericTest(typeof(int))]
[GenerateGenericTest(typeof(string))]
public class GenericTestClass<T>
{
    [Test]
    public async Task TestDefaultValue()
    {
        var def = default(T);
        // ...
    }
}
```

If the class has multiple generic test methods, every method runs under every type instantiation declared on the class.

### Step 3: Use static, non-reflective data sources

Under AOT, only data sources that don't depend on runtime reflection are safe.

**OK — static method, concrete types:**

```csharp
[Test]
[MethodDataSource(nameof(GetTestData))]
public async Task TestWithStaticData(int value, string name)
{
    await Assert.That(value).IsGreaterThan(0);
}

public static IEnumerable<Func<(int, string)>> GetTestData()
{
    yield return () => (1, "first");
    yield return () => (2, "second");
}
```

**Not OK — reflection-driven generation:**

```csharp
public IEnumerable<object[]> GetDynamicData()
{
    return SomeReflectionBasedDataGenerator.GetData();   // breaks AOT
}
```

If the data genuinely needs to be discovered at runtime (e.g. parsing a config file shipped with the test), you can use `IAsyncDiscoveryInitializer` to load it during test discovery — but the *types* of the values still need to be statically known.

### Step 4: Keep `IClassConstructor` AOT-safe

Custom `IClassConstructor` implementations interact with the trimmer because they use `Type` to construct instances. Annotate the `Type` parameter with `DynamicallyAccessedMembers(...)` so the trimmer keeps the relevant constructors:

```csharp
public sealed class CustomConstructor : IClassConstructor
{
    public Task<object> Create(
        [DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicConstructors)]
        Type type,
        ClassConstructorMetadata metadata)
    {
        return Task.FromResult(Activator.CreateInstance(type)!);
    }
}

[ClassConstructor<CustomConstructor>]
public class MyTestClass(SomeDependency dep)
{
    [Test]
    public async Task MyTest() { /* ... */ }
}
```

If your constructor needs more than public constructors (e.g. you reflect on properties for setter injection), broaden the `DynamicallyAccessedMemberTypes` flags accordingly:

```csharp
[DynamicallyAccessedMembers(
    DynamicallyAccessedMemberTypes.PublicConstructors |
    DynamicallyAccessedMemberTypes.PublicProperties)]
Type type
```

The same pattern applies to `DependencyInjectionDataSourceAttribute<TScope>.Create(scope, type)` — annotate the `Type` parameter so the DI container can resolve it under trim.

### Step 5: Use property injection with concrete types

Property injection through `[ClassDataSource<T>]` is AOT-safe because the type `T` is a compile-time generic argument:

```csharp
public class IntegrationTests
{
    [ClassDataSource<DatabaseService>(Shared = SharedType.PerTestSession)]
    public required DatabaseService Database { get; init; }

    [Test]
    public async Task Service_Initialised()
    {
        await Assert.That(Database).IsNotNull();
    }
}
```

What's *not* AOT-safe: reflecting on the test class's property list at runtime to discover injection points yourself. TUnit's source generator handles property discovery at compile time, so as long as you stick to `[ClassDataSource<T>]` / `[MethodDataSource(...)]` on `required` properties, you're fine.

### Step 6: Diagnose with verbose diagnostics if needed

If you hit a build-time TUnit error you don't recognise, enable verbose diagnostics in `.editorconfig` to get the source generator's full output:

```ini
[*.cs]
tunit.enable_verbose_diagnostics = true
```

Reset to `false` once the issue is resolved — verbose diagnostics noticeably slow builds.

## Validation

- [ ] Project file sets `<PublishAot>true</PublishAot>` and `<IsAotCompatible>true</IsAotCompatible>`
- [ ] Every generic `[Test]` method has at least one `[GenerateGenericTest(typeof(...))]` (or its containing class does)
- [ ] All `[MethodDataSource]` targets are static methods returning `IEnumerable<Func<T>>` of statically-known types — no reflection-based generation
- [ ] Custom `IClassConstructor.Create(...)` and `DependencyInjectionDataSourceAttribute<TScope>.Create(...)` annotate their `Type` parameter with `[DynamicallyAccessedMembers(...)]` matching the members they actually access
- [ ] `dotnet publish -c Release -r <rid>` succeeds without trim warnings (`IL2026`, `IL3050`)
- [ ] The published executable runs and discovers all expected tests

## Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| `TUnit0058: Generic test method requires [GenerateGenericTest]` | Add one or more `[GenerateGenericTest(typeof(T1), typeof(T2), ...)]` attributes covering every type combination you want tested. The framework can't infer them under AOT. |
| `IL2026` / `IL3050` warnings on a `[MethodDataSource]` provider | The provider uses an API that requires reflection. Replace with a static method that yields concrete values, or move the dynamic part into `IAsyncDiscoveryInitializer` while keeping the surfaced types static. |
| `IL2070` / `IL2072` on a custom `IClassConstructor` | Add `[DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicConstructors)]` (or broader, depending on what you reflect on) to the `Type` parameter of `Create(...)`. |
| Tests pass locally but `dotnet publish` fails with trim warnings | Set `<IsAotCompatible>true</IsAotCompatible>` so the analyzers run during `dotnet build` too — the warnings then surface in your normal build cycle, not only at publish time. |
| Generic test class missing class-level `[GenerateGenericTest]` even though methods have it | Generic *type parameters on the class* need `[GenerateGenericTest]` on the class. Method-level annotations only cover method-level type parameters. |
| Reflection-based DI container (e.g. resolving services by string name) inside a custom `DependencyInjectionDataSourceAttribute` | Pre-register everything explicitly, or use a DI container with first-class AOT support. The `Type` annotation only helps for the resolved test class, not the services it depends on. |
| Property-injected fixture with a non-public setter under AOT | Properties must be `public required ... { get; init; }`. Non-public setters survive trimming inconsistently and aren't part of TUnit's source-generated wiring. |
| Forgetting to test the *published* executable, only running `dotnet run` | `dotnet run` doesn't go through the AOT publish path. Always run the actual published binary to validate AOT correctness. |
