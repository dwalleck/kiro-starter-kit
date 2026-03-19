# Testing Conventions

## Integration Tests
- Use real infrastructure in containers (TestContainers), not mocks, for databases, caches, and queues.
- Use `IAsyncLifetime` for async setup/teardown.
- Always use random port mapping to avoid conflicts.
- Use Respawn for fast data reset between tests instead of recreating containers.
