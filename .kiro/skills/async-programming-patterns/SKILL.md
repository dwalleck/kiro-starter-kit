---
name: async-programming-patterns
description: Diagnosing async anti-patterns and advanced async primitives in .NET - sync-over-async deadlocks and thread-pool starvation, async void crashes, TaskCompletionSource with RunContinuationsAsynchronously, CancellationTokenSource disposal and timeout patterns, AsyncLocal execution context leaks, timer callback safety, ConcurrentDictionary.GetOrAdd with async, and async factory patterns for constructors.
---

# Async Programming Patterns

## When to Use This Skill

Use when writing or reviewing async code, debugging deadlocks or thread-pool starvation, working with CancellationTokens, TaskCompletionSource, AsyncLocal, or adapting legacy synchronous APIs to async.

## Asynchrony Is Viral

Once you go async, all callers should be async. Partial async is often worse than fully synchronous.

❌ **BAD** Sync over async — blocks the thread waiting for the result.

```csharp
public int DoSomethingAsync()
{
    var result = CallDependencyAsync().Result;
    return result + 1;
}
```

✅ **GOOD** Entire call chain is async.

```csharp
public async Task<int> DoSomethingAsync()
{
    var result = await CallDependencyAsync();
    return result + 1;
}
```

## Async Void

Never use `async void`. Unhandled exceptions crash the process. Always return `Task`.

❌ **BAD** Async void — untrackable, crashes on exception.

```csharp
public async void BackgroundOperationAsync()
{
    var result = await CallDependencyAsync();
    DoSomething(result);
}
```

✅ **GOOD** Returns Task — exceptions surface via `TaskScheduler.UnobservedTaskException`.

```csharp
public async Task BackgroundOperationAsync()
{
    var result = await CallDependencyAsync();
    DoSomething(result);
}
```

### Implicit Async Void Delegates

Watch for APIs that accept `Action` — passing an async lambda creates an implicit `async void`.

❌ **BAD** `Action` parameter silently creates async void.

```csharp
public class BackgroundQueue
{
    public static void FireAndForget(Action action) { }
}

// This is async void!
BackgroundQueue.FireAndForget(async () =>
{
    await httpClient.GetAsync("http://pinger/api/1");
});
```

✅ **GOOD** Provide a `Func<Task>` overload.

```csharp
public class BackgroundQueue
{
    public static void FireAndForget(Action action) { }
    public static void FireAndForget(Func<Task> action) { }
}
```

## Pre-Computed Values

Never use `Task.Run` for trivially computed data.

❌ **BAD** Wastes a thread-pool thread.

```csharp
public Task<int> AddAsync(int a, int b)
{
    return Task.Run(() => a + b);
}
```

✅ **GOOD** No thread needed.

```csharp
public ValueTask<int> AddAsync(int a, int b)
{
    return new ValueTask<int>(a + b);
}
```

## Long-Running Blocking Work

`Task.Run` steals a thread-pool thread. For work that blocks for the lifetime of the application (queue processors), use a dedicated thread.

❌ **BAD** Steals a thread-pool thread forever.

```csharp
public void StartProcessing()
{
    Task.Run(ProcessQueue); // ProcessQueue blocks on GetConsumingEnumerable()
}
```

✅ **GOOD** Dedicated thread.

```csharp
public void StartProcessing()
{
    var thread = new Thread(ProcessQueue) { IsBackground = true };
    thread.Start();
}
```

✅ **GOOD** `TaskCreationOptions.LongRunning` — easier to combine with `await` and TPL.

```csharp
public Task StartProcessing() =>
    Task.Factory.StartNew(ProcessQueue, TaskCreationOptions.LongRunning);
```

> Don't use `TaskCreationOptions.LongRunning` with async code — the new thread is destroyed after the first `await`.

## Sync Over Async

All of these patterns block threads and risk thread-pool starvation. None are safe.

❌ **BAD** Every variation of blocking on async.

```csharp
Task.Run(() => DoAsyncOperation()).Result;                          // blocks 2 threads
Task.Run(() => DoAsyncOperation()).GetAwaiter().GetResult();        // blocks 2 threads
Task.Run(() => DoAsyncOperation().Result).Result;                   // blocks 3 threads
DoAsyncOperation().Result;                                          // deadlock risk with SynchronizationContext
DoAsyncOperation().GetAwaiter().GetResult();                        // deadlock risk
var task = DoAsyncOperation(); task.Wait(); task.GetAwaiter().GetResult(); // deadlock risk
```

## Prefer Await Over ContinueWith

❌ **BAD** ContinueWith doesn't capture `SynchronizationContext` and is harder to read.

```csharp
public Task<int> DoSomethingAsync()
{
    return CallDependencyAsync().ContinueWith(task => task.Result + 1);
}
```

✅ **GOOD**

```csharp
public async Task<int> DoSomethingAsync()
{
    var result = await CallDependencyAsync();
    return result + 1;
}
```

## Prefer Async/Await Over Directly Returning Task

Async/await normalizes exceptions, makes debugging easier, and prevents async local leaks.

❌ **BAD** Exceptions thrown synchronously surprise the caller. Async locals leak out.

```csharp
public Task<int> DoSomethingAsync()
{
    return CallDependencyAsync();
}
```

✅ **GOOD**

```csharp
public async Task<int> DoSomethingAsync()
{
    return await CallDependencyAsync();
}
```

## TaskCompletionSource

Always use `RunContinuationsAsynchronously` to prevent inline continuations that cause deadlocks and state corruption.

❌ **BAD** Continuations run inline on the thread calling `SetResult`.

```csharp
var tcs = new TaskCompletionSource<int>();
```

✅ **GOOD** Continuations dispatch to the thread pool.

```csharp
var tcs = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
```

## CancellationToken Patterns

### Always Flow Tokens

❌ **BAD** Forgot to pass the token — operation is effectively uncancellable.

```csharp
public async Task<string> DoAsyncThing(CancellationToken cancellationToken = default)
{
    byte[] buffer = new byte[1024];
    int read = await _stream.ReadAsync(buffer, 0, buffer.Length); // missing token!
    return Encoding.UTF8.GetString(buffer, 0, read);
}
```

✅ **GOOD**

```csharp
int read = await _stream.ReadAsync(buffer, 0, buffer.Length, cancellationToken);
```

### Always Dispose Timeout CancellationTokenSources

❌ **BAD** Timer stays in the queue for the full timeout duration.

```csharp
var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
var response = await client.GetAsync(url, cts.Token);
```

✅ **GOOD**

```csharp
using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
var response = await client.GetAsync(url, cts.Token);
```

### Cancelling Uncancellable Operations

On .NET 6+, prefer `Task.WaitAsync`:

```csharp
await uncancellableTask.WaitAsync(cancellationToken);
await uncancellableTask.WaitAsync(TimeSpan.FromSeconds(10));
```

For older targets, cancel the timer when the operation completes:

```csharp
public static async Task<T> TimeoutAfter<T>(this Task<T> task, TimeSpan timeout)
{
    using var cts = new CancellationTokenSource();
    var delayTask = Task.Delay(timeout, cts.Token);
    var resultTask = await Task.WhenAny(task, delayTask);
    if (resultTask == delayTask)
        throw new OperationCanceledException();
    cts.Cancel(); // cancel the timer
    return await task;
}
```

## Stream Disposal

Disposing a `StreamWriter`/`Stream` flushes synchronously, blocking the thread.

❌ **BAD** Synchronous flush on dispose.

```csharp
using (var writer = new StreamWriter(response.Body))
{
    await writer.WriteAsync("Hello World");
} // Dispose flushes synchronously!
```

✅ **GOOD** Async dispose flushes asynchronously.

```csharp
await using (var writer = new StreamWriter(response.Body))
{
    await writer.WriteAsync("Hello World");
}
```

## AsyncLocal Pitfalls

### Don't Store Disposable Objects

Execution context is copy-on-write. Setting the async local to null creates a new context — it doesn't affect contexts already captured by `Task.Run`, `CancellationToken.Register`, etc.

```csharp
DisposableThing.Current = new DisposableThing();
_ = Task.Run(async () =>
{
    await Task.Delay(1000);
    DisposableThing.Current.Value; // ObjectDisposedException!
});
DisposableThing.Current = null; // only affects future reads
thing.Dispose();
```

### Don't Store Non-Thread-Safe Objects

Async locals can be accessed from arbitrary threads. Use `ConcurrentDictionary`, not `Dictionary`.

### Set Async Locals in Async Methods Only

Non-async methods propagate mutations to callers. Async methods restore the original execution context on exit.

❌ **BAD** Mutations leak to callers — prints 2, 2, 2.

```csharp
void MethodA() { local.Value = 1; MethodB(); }
void MethodB() { local.Value = 2; }
```

✅ **GOOD** Each method's mutations are scoped — prints 2, 1, 0.

```csharp
async Task MethodA() { local.Value = 1; await MethodB(); }
async Task MethodB() { local.Value = 2; }
```

### Execution Context Leaks

APIs like `CancellationToken.Register`, `Timer`, `ThreadPool.QueueUserWorkItem` capture the execution context, including all async locals. This can cause memory leaks when async locals hold large objects.

✅ **GOOD** Use `UnsafeRegister` to avoid capturing execution context in long-lived registrations.

```csharp
cts.Token.UnsafeRegister((_, _) => _cache.TryRemove(key, out _), null);
```

## Timer Callbacks

❌ **BAD** Async void timer callback — crashes on exception.

```csharp
public async void Heartbeat(object state)
{
    await _client.GetAsync("http://mybackend/api/ping");
}
```

❌ **BAD** Blocking in timer callback — thread-pool starvation.

```csharp
public void Heartbeat(object state)
{
    _client.GetAsync("http://mybackend/api/ping").GetAwaiter().GetResult();
}
```

✅ **GOOD** Discard a Task-returning method.

```csharp
public void Heartbeat(object state)
{
    _ = DoAsyncPing();
}

private async Task DoAsyncPing()
{
    await _client.GetAsync("http://mybackend/api/ping");
}
```

✅ **GOOD** Use `PeriodicTimer` (.NET 6+).

```csharp
private async Task DoAsyncPings()
{
    while (await _timer.WaitForNextTickAsync())
    {
        await _client.GetAsync("http://mybackend/api/ping");
    }
}
```

## ConcurrentDictionary.GetOrAdd with Async

❌ **BAD** Blocking inside GetOrAdd — thread-pool starvation.

```csharp
var person = _cache.GetOrAdd(id, key => _db.People.FindAsync(key).Result);
```

✅ **GOOD** Cache the Task, not the result.

```csharp
var person = await _cache.GetOrAdd(id, key => _db.People.FindAsync(key));
```

✅ **GOOD** Use `AsyncLazy<T>` to prevent duplicate computation.

```csharp
var person = await _cache.GetOrAdd(id,
    key => new AsyncLazy<Person>(() => _db.People.FindAsync(key))).Value;

private class AsyncLazy<T> : Lazy<Task<T>>
{
    public AsyncLazy(Func<Task<T>> valueFactory) : base(valueFactory) { }
}
```

## Async Constructors

Constructors are synchronous. Don't block on async in constructors.

❌ **BAD** Sync over async in constructor.

```csharp
public Service(IRemoteConnectionFactory factory)
{
    _connection = factory.ConnectAsync().Result;
}
```

✅ **GOOD** Static factory pattern.

```csharp
private Service(IRemoteConnection connection) => _connection = connection;

public static async Task<Service> CreateAsync(IRemoteConnectionFactory factory)
{
    return new Service(await factory.ConnectAsync());
}
```

## Attribution

Based on [AspNetCoreDiagnosticScenarios](https://github.com/davidfowl/AspNetCoreDiagnosticScenarios) by David Fowler. Content was rephrased for compliance with licensing restrictions.
