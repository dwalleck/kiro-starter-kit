# Quality Gates

## Slopwatch
- Zero tolerance for new slop: disabled tests, suppressed warnings, empty catch blocks, arbitrary `Task.Delay`, project-level `NoWarn`, CPM bypass with inline versions.
- If slopwatch flags an issue, fix the underlying problem. Do not update the baseline to make it pass.
- Baseline updates require documented justification (third-party constraint, generated code).

## CRAP Scores
- New code: line coverage > 80%, branch coverage > 60%, CRAP score < 30.
- Use OpenCover format in `coverage.runsettings` — required for cyclomatic complexity metrics.
- Generate reports with ReportGenerator. Check Risk Hotspots for high-complexity, low-coverage methods.
- High CRAP score (> 30) means: add tests or refactor to reduce complexity. Not optional.

## Coverage Collection
- Exclude test assemblies, benchmarks, migrations, generated code, and auto-properties from coverage.
- Use `ExcludeFromCodeCoverageAttribute` for intentional exclusions, not `#pragma warning disable`.
