---
name: tunit-mocking
description: "TUnit's source-generated, AOT-compatible mocking framework — TUnit.Mocks. Use whenever the user is mocking dependencies in TUnit tests, references Mock.Of<T>(), `.Mock()` extension methods, `Any()`, `Is<T>(...)`, `WasCalled(Times.Once)`, or asks how to stub HttpClient/ILogger/ILogger<T> in TUnit. Also use when the user mentions the TUnit.Mocks, TUnit.Mocks.Http, or TUnit.Mocks.Logging packages, or asks how to verify mock calls without Moq/NSubstitute. Covers mock creation, setup (Returns/Throws/Callback/sequences/properties), argument matchers, call verification with the Times constraints, ordered verification, HTTP request matching and verification, and ILogger entry assertions."
---

# Mocking with TUnit.Mocks

Help users mock dependencies in TUnit tests using TUnit's first-party, source-generated mock framework.

## When to Use

- User is mocking interfaces or classes in TUnit tests
- User references `Mock.Of<T>()`, `.Mock()`, `Any()`, `Is<T>(...)`, `WasCalled`, `Times.*`
- User wants to stub an `HttpClient` / `HttpMessageHandler` in a TUnit test
- User wants to assert log entries via `ILogger` / `ILogger<T>` in a TUnit test

## When Not to Use

- User is using Moq or NSubstitute (those have their own conventions; TUnit.Mocks is a separate library)
- User is writing a non-TUnit test (TUnit.Mocks targets TUnit; for other frameworks use Moq/NSubstitute)
- User wants test authoring guidance generally — use `writing-tunit-tests`

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| Interface or virtual class to mock | Yes | The dependency being mocked |
| Test scenario | No | What behavior to verify |

## Workflow

### Step 1: Install the right package

TUnit.Mocks ships as separate packages so you only pay for what you use:

```bash
dotnet add package TUnit.Mocks --prerelease
dotnet add package TUnit.Mocks.Http --prerelease       # only if mocking HttpClient
dotnet add package TUnit.Mocks.Logging --prerelease    # only if asserting ILogger
```

Requirements:

- **C# 14 or later** — older language versions trigger `TM004` at build time. Set `<LangVersion>latest</LangVersion>` (or `14`) in the test project.
- TUnit.Mocks is **source-generated** and **AOT-compatible** — it works with NativeAOT, trimming, and single-file publishing without reflection at runtime.

### Step 2: Create a mock

Two equivalent forms — pick one and stay consistent:

```csharp
using TUnit.Mocks;

// Extension method form (preferred for fluency)
var greeter = IGreeter.Mock();

// Static factory form
var greeter = Mock.Of<IGreeter>();
```

The mock **is** the interface — there is no `.Object` property to unwrap (unlike Moq):

```csharp
IGreeter g = greeter;          // direct assignment
service.Inject(greeter);       // pass straight in
```

### Step 3: Configure return values, throws, and callbacks

Use the same call shape on the mock as on the real interface, then chain a behavior:

```csharp
// Return a value
mock.GetUser(Any()).Returns(new User("Alice"));

// Async methods auto-wrap in Task<T> / ValueTask<T>
mock.GetUserAsync(Any()).Returns(new User("Alice"));

// Computed return — runs the lambda each call
mock.GetTimestamp(Any()).Returns(() => DateTime.UtcNow);

// Throw an exception type
mock.Delete(Any()).Throws<InvalidOperationException>();

// Throw a specific instance
mock.Delete(Any()).Throws(new ArgumentException("bad id"));

// Side-effect callback (no return)
mock.Process(Any()).Callback(() => callCount++);

// Callback with arguments
mock.Process(Any()).Callback((object?[] args) =>
    Console.WriteLine($"Called with: {args[0]}"));
```

#### Sequences — different behavior per call

When the same method should produce different results on successive calls, use `.Then()` to chain or `.ReturnsSequentially(...)` for value-only sequences:

```csharp
// Throw, then succeed, then return cached
mock.GetValue(Any())
    .Throws<InvalidOperationException>()
    .Then().Returns("retry-succeeded")
    .Then().Returns("cached");

// Shorthand for value sequences
mock.GetValue(Any()).ReturnsSequentially("first", "second", "third");
```

The last entry repeats indefinitely after the sequence is exhausted.

#### Property setups

```csharp
// Getter — most concise form
mock.Name.Returns("Alice");

// Equivalent explicit form
mock.Name.Getter.Returns("Alice");

// Setter — fire a callback whenever the property is assigned
mock.Count.Setter.Callback(() => Console.WriteLine("Count was set"));

// Setter — only when assigned a specific value
mock.Count.Set(Is(42)).Callback(() => Console.WriteLine("Count set to 42"));
```

### Step 4: Match arguments with `Arg`

Setups and verifications use argument matchers from the `Arg` static class. TUnit.Mocks adds `using static TUnit.Mocks.Arg` as a `global using` so the matchers are available unqualified:

| Matcher | Meaning |
|---|---|
| `Any()` or `Any<T>()` | Any value, including `null` |
| `Is<T>(value)` | Exact equality |
| `Is<T>(predicate)` | Value satisfies a predicate |
| `IsNotNull<T>()` | Value is not `null` |
| `IsIn(a, b, c)` | Value is one of the listed |
| `IsNotIn(a, b, c)` | Value is none of the listed |

```csharp
mock.GetUser(Is(42)).Returns(new User("Alice"));
mock.GetUser(Is<int>(id => id > 0)).Returns(new User("Valid"));
mock.Process(IsNotNull<string>()).Returns("had value");
mock.GetRole(IsIn("admin", "editor", "viewer")).Returns(true);
mock.GetRole(IsNotIn("admin", "superadmin")).Returns(false);
```

For ref struct parameters on .NET 9+, use `RefStructArg<T>.Any` instead of `Any<T>()` — ref structs cannot be generic type arguments, so the standard matchers don't apply.

### Step 5: Verify calls

After exercising the system under test, assert what was called on the mock.

```csharp
// Was called at least once
mock.GetUser(42).WasCalled();

// Was called exactly once
mock.GetUser(42).WasCalled(Times.Once);

// Was never called
mock.Delete(Any()).WasNeverCalled();

// With argument matchers
mock.GetUser(Any()).WasCalled(Times.Exactly(3));
mock.GetUser(id => id > 0).WasCalled(Times.AtLeast(1));
```

`Times` constants:

| Constant | Meaning |
|---|---|
| `Times.Once` | Exactly 1 |
| `Times.Never` | Exactly 0 |
| `Times.AtLeastOnce` | ≥ 1 |
| `Times.Exactly(n)` | Exactly `n` |
| `Times.AtLeast(n)` | ≥ `n` |
| `Times.AtMost(n)` | ≤ `n` |
| `Times.Between(min, max)` | Inclusive range |

#### Ordered verification

When the *order* of calls matters across mocks, wrap the expectations in `Mock.VerifyInOrder(...)`:

```csharp
Mock.VerifyInOrder(() =>
{
    mockLogger.Log("Starting").WasCalled();
    mockRepo.SaveAsync(Any()).WasCalled();
    mockLogger.Log("Done").WasCalled();
});
```

If the actual call order differs, the verification fails.

#### Strict verification

To assert that **no** calls happened beyond what was explicitly verified:

```csharp
mock.GetUser(1).WasCalled(Times.Once);
mock.Delete(2).WasCalled(Times.Once);
mock.VerifyNoOtherCalls();   // throws if any other calls were made
```

Use this sparingly — it makes tests brittle to implementation changes. Prefer to verify only what the test actually cares about.

### Step 6: Mock HTTP with TUnit.Mocks.Http

`Mock.HttpClient(...)` returns a real `HttpClient` backed by an interceptor handler — drop-in for code that takes an `HttpClient`:

```csharp
using var client = Mock.HttpClient("https://example.com");

client.Handler
    .OnGet("/api/users")
    .RespondWithJson("""[{"id": 1, "name": "Alice"}]""");

client.Handler
    .OnPost("/api/users")
    .Respond(HttpStatusCode.Created);

client.Handler
    .OnGet("/api/version")
    .RespondWithString("1.0.0");
```

Without a base address: `Mock.HttpClient()`. To get the handler alone (e.g. to inject into `new HttpClient(handler)`): `Mock.HttpHandler()`.

#### Response builder — status, body, headers

```csharp
client.Handler
    .OnGet("/api/data")
    .Respond(HttpStatusCode.OK)
    .WithJsonContent("""{"key": "value"}""")
    .WithHeader("X-Request-Id", "abc123");
```

#### Custom request matching

```csharp
client.Handler.OnRequest(r => r.PathStartsWith("/api/v2"))
    .RespondWithJson("""{"version": 2}""");

client.Handler.OnRequest(r => r.PathMatches(@"/api/users/\d+"))
    .RespondWithJson("""{"id": 1, "name": "Alice"}""");

client.Handler.OnRequest(r => r.Header("Authorization", "Bearer token"))
    .RespondWithJson("""{"user": "admin"}""");

client.Handler.OnRequest(r => r.BodyContains("searchQuery"))
    .RespondWithJson("""{"results": []}""");
```

#### Sequenced responses

```csharp
var setup = client.Handler.OnGet("/api/status");
setup.RespondWithString("starting");
setup.Then().RespondWithString("running");
setup.Then().RespondWithString("complete");
// 4th call onward repeats "complete"
```

#### Verification

```csharp
// Verify a request matched
client.Handler.Verify(r => r.Method(HttpMethod.Get).Path("/api/users"), Times.Once);

// Strict: no requests outside the configured matchers
client.Handler.VerifyNoUnmatchedRequests();

// Inspect the request log directly
await Assert.That(client.Handler.Requests).Count().IsEqualTo(2);
await Assert.That(client.Handler.Requests[0].Method).IsEqualTo(HttpMethod.Get);
```

### Step 7: Mock ILogger with TUnit.Mocks.Logging

`Mock.Logger(...)` produces a real `ILogger` (or `ILogger<T>`) that records every entry for inspection.

```csharp
// Untyped ILogger
var logger = Mock.Logger();

// With a category name
var logger = Mock.Logger("MyApp.Services");

// Generic ILogger<T>
var logger = Mock.Logger<MyService>();
```

#### Asserting log entries

Fluent matcher API:

```csharp
// By level
logger.VerifyLog().AtLevel(LogLevel.Error).WasCalled(Times.Once);

// By message substring
logger.VerifyLog().ContainingMessage("failed").WasCalled();

// By exact message
logger.VerifyLog().WithMessage("Operation completed").WasCalled();

// By thrown exception type
logger.VerifyLog().WithException<InvalidOperationException>().WasCalled(Times.Once);

// Combined filters
logger.VerifyLog()
    .AtLevel(LogLevel.Error)
    .ContainingMessage("timeout")
    .WithException<TimeoutException>()
    .WasCalled(Times.AtLeastOnce);
```

Shorthand forms:

```csharp
// Verify at level, with message substring, at least once
logger.VerifyLog(LogLevel.Error, "connection failed");

// Verify with explicit count
logger.VerifyLog(LogLevel.Warning, "retry", Times.Exactly(3));

// Verify nothing was logged at a level
logger.VerifyNoLog(LogLevel.Error);

// Verify nothing was logged at all
logger.VerifyNoLogs();
```

#### Inspecting captured entries directly

```csharp
foreach (var entry in logger.Entries)
{
    // entry.LogLevel, entry.Message, entry.Exception,
    // entry.Timestamp, entry.CategoryName
}

var latest = logger.LatestEntry;
await Assert.That(latest.LogLevel).IsEqualTo(LogLevel.Information);
```

## Validation

- [ ] Test project sets `<LangVersion>latest</LangVersion>` (or `14`) — TUnit.Mocks requires C# 14
- [ ] Mock creation uses `IT.Mock()` or `Mock.Of<IT>()` consistently across the project
- [ ] Argument matchers are imported via the auto-applied `global using static TUnit.Mocks.Arg`
- [ ] Async setups use `.Returns(value)` directly — no `Task.FromResult` wrapping needed
- [ ] `WasCalled(Times.X)` is used for explicit count assertions, not raw `WasCalled()` when a count matters
- [ ] HTTP mocks use `Mock.HttpClient(...)` rather than custom `HttpMessageHandler` subclasses
- [ ] `ILogger` assertions use `logger.VerifyLog(...)` rather than reading framework-internal state

## Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| `TM004` build error on mock generation | Bump `<LangVersion>` to `14` (or `latest`) — TUnit.Mocks requires C# 14. |
| Wrapping async return values: `Returns(Task.FromResult(value))` | Just write `Returns(value)` — TUnit.Mocks auto-wraps to `Task<T>`/`ValueTask<T>` based on the method's return type. |
| Looking for `.Object` on the mock | There isn't one. The mock IS the interface. Pass it directly. |
| Forgetting `Any()` in setups: `mock.GetUser(42).Returns(...)` when you wanted any input | If the test uses a specific id, `Is(42)` makes intent explicit; if any value should match, use `Any()`. Setting up with a literal value only matches that exact value. |
| `WasCalled()` (no `Times.*`) used to assert exactly-once | `WasCalled()` checks "at least once." Use `WasCalled(Times.Once)` for exactly one call. |
| `VerifyNoOtherCalls()` on every test, then breaking on every refactor | Use only when the contract really is "these calls and nothing else." Otherwise, verify the calls you care about and let the rest go. |
| Mocking `HttpClient` by subclassing `HttpMessageHandler` instead of using `Mock.HttpClient(...)` | `Mock.HttpClient(...)` gives matching/verification/sequence support out of the box. Hand-rolled handlers re-implement all of that. |
| Asserting on log strings via `mock.LoggedMessages` | Use `Mock.Logger()` from TUnit.Mocks.Logging. The `VerifyLog(...)` API is purpose-built for log assertions and survives format-string changes. |
| Ref-struct parameters fail to compile with `Any<T>()` | On .NET 9+, use `RefStructArg<T>.Any` for ref-struct parameters — they can't be generic type arguments. |
| Ordering verification using a list of `WasCalled` calls outside `VerifyInOrder` | Individual `WasCalled` checks don't enforce order. Wrap the sequence in `Mock.VerifyInOrder(() => { ... })`. |
