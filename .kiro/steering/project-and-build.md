# Project Structure and Build

## Solution Format
- Use `.slnx` (XML solution format) for new solutions and migrate existing `.sln` files.
- Never keep both `.sln` and `.slnx` in the same repo.

## Directory.Build.props
- Centralize build properties at the solution root: `LangVersion`, `Nullable`, `TreatWarningsAsErrors`, metadata, SourceLink.
- Define reusable target framework properties (`NetLibVersion`, `NetTestVersion`) — reference in project files.
- Enable SourceLink with `PublishRepositoryUrl`, `EmbedUntrackedSources`, `IncludeSymbols`.

## Package Management
- Never edit `.csproj` or `Directory.Packages.props` XML directly. Use `dotnet add/remove/list` commands.
- Use Central Package Management (CPM) with `ManagePackageVersionsCentrally`.
- Group related packages with shared version variables (`$(AkkaVersion)`, `$(AspireVersion)`).
- Label ItemGroups in Directory.Packages.props by category (App, Build, Test).
- No inline `Version` attributes on PackageReference when CPM is enabled.
- `VersionOverride` is an escape hatch — use sparingly and document why.

## SDK Pinning
- Pin SDK version in `global.json` with `rollForward: latestFeature`.

## Local Tools
- Use `.config/dotnet-tools.json` for team-shared tooling (ReportGenerator, Slopwatch, etc.).
- Restore with `dotnet tool restore` in CI and onboarding.
