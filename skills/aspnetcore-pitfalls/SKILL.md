---
name: aspnetcore-pitfalls
description: HttpContext lifecycle and thread-safety violations in ASP.NET Core - fire-and-forget patterns capturing HttpContext or scoped services, sync-over-async on request/response bodies, accessing HttpContext from parallel tasks or after request completion, response header timing after body writes.
---

# ASP.NET Core Pitfalls

## When to Use This Skill

Use when writing ASP.NET Core controllers, middleware, or background work triggered by HTTP requests. Especially relevant for fire-and-forget patterns, parallel request processing, and HttpContext access.

## Synchronous I/O on Request/Response Bodies

Kestrel does not support synchronous reads. Using sync overloads on `HttpRequest.Body` or `HttpResponse.Body` causes sync-over-async and thread-pool starvation.

❌ **BAD** Synchronous read blocks the thread.

```csharp
[HttpGet("/pokemon")]
public ActionResult<PokemonData> Get()
{
    var json = new StreamReader(Request.Body).ReadToEnd();
    return JsonConvert.DeserializeObject<PokemonData>(json);
}
```

✅ **GOOD** Async read.

```csharp
[HttpGet("/pokemon")]
public async Task<ActionResult<PokemonData>> Get()
{
    var json = await new StreamReader(Request.Body).ReadToEndAsync();
    return JsonConvert.DeserializeObject<PokemonData>(json);
}
```

## HttpRequest.Form Is Sync-Over-Async

❌ **BAD** `HttpRequest.Form` blocks under the covers.

```csharp
[HttpPost("/form-body")]
public IActionResult Post()
{
    var form = HttpRequest.Form;
    Process(form["id"], form["name"]);
    return Accepted();
}
```

✅ **GOOD** Use `ReadFormAsync()`.

```csharp
[HttpPost("/form-body")]
public async Task<IActionResult> Post()
{
    var form = await HttpRequest.ReadFormAsync();
    Process(form["id"], form["name"]);
    return Accepted();
}
```

## Don't Store HttpContext in a Field

`IHttpContextAccessor.HttpContext` returns the context for the active request. Storing it in a field captures a null or stale reference.

❌ **BAD** Captures HttpContext at construction time — likely null or wrong request.

```csharp
public class MyType
{
    private readonly HttpContext _context;
    public MyType(IHttpContextAccessor accessor)
    {
        _context = accessor.HttpContext;
    }
}
```

✅ **GOOD** Store the accessor, read HttpContext at call time.

```csharp
public class MyType
{
    private readonly IHttpContextAccessor _accessor;
    public MyType(IHttpContextAccessor accessor) => _accessor = accessor;

    public void CheckAdmin()
    {
        var context = _accessor.HttpContext;
        if (context != null && !context.User.IsInRole("admin"))
            throw new UnauthorizedAccessException("Not an admin");
    }
}
```

## HttpContext Is Not Thread-Safe

Accessing `HttpContext` from multiple threads causes corruption, hangs, and data loss.

❌ **BAD** Multiple parallel tasks access HttpContext.

```csharp
[HttpGet("/search")]
public async Task<SearchResults> Get(string query)
{
    var q1 = SearchAsync(SearchEngine.Google, query);
    var q2 = SearchAsync(SearchEngine.Bing, query);
    await Task.WhenAll(q1, q2);
    return SearchResults.Combine(await q1, await q2);
}

private async Task<SearchResults> SearchAsync(SearchEngine engine, string query)
{
    _logger.LogInformation("Starting from {path}.", HttpContext.Request.Path); // race!
    return await _searchService.SearchAsync(engine, query);
}
```

✅ **GOOD** Copy data before parallel work.

```csharp
[HttpGet("/search")]
public async Task<SearchResults> Get(string query)
{
    string path = HttpContext.Request.Path;
    var q1 = SearchAsync(SearchEngine.Google, query, path);
    var q2 = SearchAsync(SearchEngine.Bing, query, path);
    await Task.WhenAll(q1, q2);
    return SearchResults.Combine(await q1, await q2);
}

private async Task<SearchResults> SearchAsync(SearchEngine engine, string query, string path)
{
    _logger.LogInformation("Starting from {path}.", path);
    return await _searchService.SearchAsync(engine, query);
}
```

## Don't Capture HttpContext in Background Threads

`HttpContext` is recycled when the request completes. Background work that outlives the request reads bogus data.

❌ **BAD** Closure captures HttpContext — may execute after request completes.

```csharp
[HttpGet("/fire-and-forget-1")]
public IActionResult FireAndForget()
{
    _ = Task.Run(async () =>
    {
        await Task.Delay(1000);
        var path = HttpContext.Request.Path; // bogus!
        Log(path);
    });
    return Accepted();
}
```

✅ **GOOD** Copy needed data before spawning background work.

```csharp
[HttpGet("/fire-and-forget-3")]
public IActionResult FireAndForget()
{
    string path = HttpContext.Request.Path;
    _ = Task.Run(async () =>
    {
        await Task.Delay(1000);
        Log(path);
    });
    return Accepted();
}
```

## Don't Capture Scoped Services in Background Threads

Scoped services (DbContext, repositories) are disposed when the request ends. Background threads get `ObjectDisposedException`.

❌ **BAD** Captures request-scoped DbContext in background thread.

```csharp
[HttpGet("/fire-and-forget-1")]
public IActionResult FireAndForget([FromServices] PokemonDbContext context)
{
    _ = Task.Run(async () =>
    {
        await Task.Delay(1000);
        context.Pokemon.Add(new Pokemon()); // ObjectDisposedException!
        await context.SaveChangesAsync();
    });
    return Accepted();
}
```

✅ **GOOD** Create a new DI scope for background work.

```csharp
[HttpGet("/fire-and-forget-3")]
public IActionResult FireAndForget([FromServices] IServiceScopeFactory scopeFactory)
{
    _ = Task.Run(async () =>
    {
        await Task.Delay(1000);
        using var scope = scopeFactory.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<PokemonDbContext>();
        context.Pokemon.Add(new Pokemon());
        await context.SaveChangesAsync();
    });
    return Accepted();
}
```

## Response Headers After Response Has Started

ASP.NET Core doesn't buffer the response body. Once the first write happens, headers are sent to the client and can't be changed.

❌ **BAD** Tries to set headers after body has been written.

```csharp
app.Use(async (next, context) =>
{
    await context.Response.WriteAsync("Hello ");
    await next();
    context.Response.Headers["test"] = "value"; // may throw
});
```

✅ **GOOD** Check `HasStarted` or use `OnStarting` callback.

```csharp
app.Use(async (next, context) =>
{
    context.Response.OnStarting(() =>
    {
        context.Response.Headers["someheader"] = "somevalue";
        return Task.CompletedTask;
    });
    await next();
});
```

## Large Request/Response Bodies

Objects > 85KB land on the Large Object Heap (LOH), triggering expensive Gen 2 garbage collections. Don't read entire request/response bodies into a single `byte[]` or `string`.

- Stream large payloads instead of buffering.
- Use `ArrayPool<byte>.Shared` for temporary buffers.
- Set request size limits to prevent denial-of-service.

## Attribution

Based on [AspNetCoreDiagnosticScenarios](https://github.com/davidfowl/AspNetCoreDiagnosticScenarios) by David Fowler. Content was rephrased for compliance with licensing restrictions.
