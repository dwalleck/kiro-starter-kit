---
name: migrate-to-tunit
description: "Migrate xUnit, NUnit, or MSTest test suites to TUnit. Use whenever the user wants to port tests from another framework to TUnit, or asks how to convert specific patterns: [Fact]/[Theory]/[InlineData]/IClassFixture (xUnit), [TestCase]/[TestCaseSource]/[SetUp]/[OneTimeSetUp] (NUnit), [TestClass]/[TestMethod]/[DataRow]/[DynamicData]/[TestInitialize] (MSTest). Covers attribute mapping tables, the assertion-shape change to `await Assert.That(...).IsEqualTo(...)`, the project-file changes (Microsoft.Testing.Platform, dotnet run vs dotnet test), the async-Task-by-default test signature, and the universal pitfalls when switching from sync-result Assert.Equal to awaited Assert.That."
---

# Migrate to TUnit

Help users port a test suite from xUnit, NUnit, or MSTest to TUnit. The mechanical work is attribute renaming; the substantive work is rethinking assertion shape, async signatures, and lifecycle scope.

## When to Use

- User wants to port tests from xUnit/NUnit/MSTest to TUnit
- User asks how a specific attribute or API maps to TUnit
- User has mixed test frameworks in a repo and is consolidating on TUnit

## When Not to Use

- User wants to author new TUnit tests from scratch (use `writing-tunit-tests`)
- User is migrating between minor versions of the same framework (e.g. xUnit v2 → v3 — use `migrate-xunit-to-xunit-v3`; MSTest v3 → v4 — use `migrate-mstest-v3-to-v4`)
- User is migrating to MTP runner without changing framework (use `migrate-vstest-to-mtp`)

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| Source framework | Yes | xUnit, NUnit, or MSTest |
| Test project file | Yes | The `.csproj` to update |
| Test files | Yes | Source files using the existing framework |

## Workflow

### Step 1: Determine the source framework

Read the test project's package references and look at the attributes used:

| Marker | Source framework |
|---|---|
| `xunit` / `xunit.v3` package, `[Fact]` / `[Theory]` | **xUnit** |
| `NUnit` package, `[Test]` / `[TestCase]` / `[TestFixture]` | **NUnit** |
| `MSTest.TestFramework` / `MSTest.Sdk`, `[TestClass]` / `[TestMethod]` | **MSTest** |

If the project mixes frameworks (rare), migrate one at a time.

### Step 2: Update the test project file

Replace the framework's package and adapter with TUnit, set `OutputType=Exe`, and ensure `LangVersion` is recent enough:

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

Remove these (whichever applied):

- `xunit`, `xunit.v3`, `xunit.runner.visualstudio`, `Xunit.Microsoft.DependencyInjection`
- `NUnit`, `NUnit3TestAdapter`, `NUnit.Analyzers`
- `MSTest.TestFramework`, `MSTest.TestAdapter`, `MSTest.Sdk` (replace `<Project Sdk="MSTest.Sdk">` with the standard SDK above)
- `Microsoft.NET.Test.Sdk` (TUnit doesn't use VSTest)

### Step 3: Switch the run command

TUnit runs on Microsoft.Testing.Platform — the test project compiles to a standalone executable. Don't use `dotnet test`:

```bash
# Old (any of the three frameworks)
dotnet test

# New (TUnit)
dotnet run --project tests/MyProject.Tests/

# Filter
dotnet run --project tests/MyProject.Tests/ -- --filter "FullyQualifiedName~Login"
```

`dotnet test` requires extra opt-in on .NET 10 SDK and fails without it. Update CI/CD scripts accordingly.

### Step 4: Apply the universal changes

Regardless of the source framework, every test file gets these changes:

#### Test methods become `async Task`

TUnit assertions are awaitable. Change every test method's return type:

```csharp
// Before — any framework
public void MyTest() { Assert.Equal(5, result); }

// After — TUnit
public async Task MyTest() { await Assert.That(result).IsEqualTo(5); }
```

#### Assertions move from result-returning to awaited fluent chain

| Source pattern | TUnit |
|---|---|
| `Assert.Equal(expected, actual)` (xUnit) | `await Assert.That(actual).IsEqualTo(expected)` |
| `Assert.That(actual, Is.EqualTo(expected))` (NUnit) | `await Assert.That(actual).IsEqualTo(expected)` |
| `Assert.AreEqual(expected, actual)` (MSTest) | `await Assert.That(actual).IsEqualTo(expected)` |
| `Assert.NotNull(value)` / `Assert.IsNotNull(value)` | `await Assert.That(value).IsNotNull()` |
| `Assert.Throws<T>(() => ...)` | `await Assert.That(() => ...).Throws<T>()` |
| `Assert.ThrowsAsync<T>(async () => ...)` | `await Assert.That(async () => ...).Throws<T>()` |

The single biggest silent-failure risk during migration is **forgetting `await`** on TUnit assertions — without it, the test passes regardless of the actual value. The TUnit analyzer flags this; treat the warning as a blocker. Plan to do a final pass with `grep -n "Assert.That" --include="*.cs" -r tests/ | grep -v "await"` after migration.

#### Test ordering and isolation

TUnit runs in parallel by default and **constructs a new instance of the test class per test** — same as xUnit. Migrating from:

- **xUnit**: behaviour matches; no change needed beyond mechanical attribute renames.
- **NUnit / MSTest**: tests previously shared an instance across methods within the class. After migration, instance-field state set in one test will not survive into the next. Move setup to `[Before(Test)]` and rely on it running per-test, not once-per-class.

### Step 5: Apply source-specific attribute mappings

Read the file relevant to the source framework — each contains the full attribute mapping, worked BEFORE/AFTER examples, and source-specific pitfalls:

| Source | Reference |
|---|---|
| xUnit | [`references/from-xunit.md`](references/from-xunit.md) |
| NUnit | [`references/from-nunit.md`](references/from-nunit.md) |
| MSTest | [`references/from-mstest.md`](references/from-mstest.md) |

### Step 6: Run, verify, and iterate

```bash
dotnet build                                            # catch attribute / API errors first
dotnet run --project tests/MyProject.Tests/             # run the suite
```

Expected post-migration smoke checks:

- Compile cleanly — most migration errors surface as build failures, not runtime ones, because TUnit attributes are source-generated.
- Test counts match (or differ predictably — see source-specific reference for parametrized-test count differences).
- No `await`-missing analyzer warnings.

When something fails, work top-down: framework-level setup (`[Before(Assembly)]`, `[Before(Class)]`) before per-test logic.

## Validation

- [ ] Project file: `<OutputType>Exe</OutputType>`, references `TUnit`, no longer references the source framework or `Microsoft.NET.Test.Sdk`
- [ ] CI scripts use `dotnet run --project ...`, not `dotnet test`
- [ ] Every test method returns `async Task` (or `Task` if not awaiting anything, but async is conventional)
- [ ] Every `Assert.That(...)` is preceded by `await`
- [ ] No `[TestClass]` / `[TestFixture]` left over (TUnit doesn't need them)
- [ ] Setup that depended on shared instance state has been moved to `[Before(Test)]` (NUnit/MSTest sources only)
- [ ] Async exception assertions use `Assert.That(async () => ...).Throws<T>()`, not `Assert.ThrowsAsync<T>(...)` (which is xUnit/MSTest-shaped)
- [ ] All tests pass on the new runner

## Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| Forgetting to `await` `Assert.That(...)` after migration — tests pass silently | The TUnit analyzer warns. Treat the warning as a blocker. Run a final `grep` for `Assert.That` lines without `await`. |
| `dotnet test` fails after migration with an unfamiliar error | Switch to `dotnet run --project ...`. TUnit runs on Microsoft.Testing.Platform, not VSTest. |
| MSTest/NUnit suite suddenly has order-dependent failures after migration | Both default to one-instance-per-class; TUnit defaults to one-instance-per-test (xUnit-style). Move shared state from instance fields into `[Before(Test)]` setup or `[ClassDataSource<T>(Shared = SharedType.PerClass)]`. |
| Carrying `[TestClass]` or `[TestFixture]` over | Remove them — they're noise in TUnit. |
| `[ClassInitialize]` with a `TestContext` parameter still has the parameter after migration | TUnit's `[Before(Class)]` doesn't take `TestContext`. Drop the parameter. |
| Async exception tests use `await Assert.ThrowsAsync<T>(...)` after migration | Convert to `await Assert.That(async () => ...).Throws<T>()`. The exception-assertion shape is the same regardless of sync/async; the lambda type changes. |
| `[InlineData]` (xUnit) / `[TestCase]` (NUnit) / `[DataRow]` (MSTest) all rename to `[Arguments]`, but the order of arguments in MSTest's `Assert.AreEqual(expected, actual)` stays in the test body | After mapping `[DataRow]` → `[Arguments]`, also flip `Assert.AreEqual(expected, actual)` calls into `await Assert.That(actual).IsEqualTo(expected)`. The arguments swap roles. |
| Tests that relied on `IClassFixture<T>` (xUnit) / shared base class (NUnit/MSTest) lose their fixture | Use `[ClassDataSource<T>(Shared = SharedType.PerClass)]` for the same lifetime semantics. For session-wide sharing, use `SharedType.PerTestSession`. |
| Custom `[Trait]` / `[TestCategory]` / `[Category]` filters in CI break | Map to `[Property("Category", "...")]` and update the CI filter expression accordingly. |
