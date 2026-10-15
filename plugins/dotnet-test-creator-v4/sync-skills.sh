#!/usr/bin/env bash
# Re-vendor this plugin's skills from a checkout of github.com/dotnet/skills.
#
#   ./sync-skills.sh [path-to-skills-repo]     (default: ~/repos/skills)
#
# The pipeline agents under agents/ were adapted from the same repo's
# plugins/dotnet-test/agents/*.agent.md; see README.md "Keeping up with
# upstream" for what was changed, so a future re-sync of the agents is a
# mechanical diff rather than a rewrite.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="${1:-$HOME/repos/skills}"
src="$repo/plugins/dotnet-test/skills"

if [[ ! -d "$src" ]]; then
  echo "error: $src does not exist (pass the path to a dotnet/skills checkout)" >&2
  exit 1
fi

# Core: read by the pipeline agents.
skills=(
  code-testing              # unit-test-generation.prompt.md + the Direct-strategy contract
  code-testing-extensions   # per-language build/test/registration guidance
  test-analysis-extensions  # per-language assertion/marker tables for the audit skills
  find-untested-sources     # deterministic source-to-test pairing (researcher)
  test-gap-analysis         # pseudo-mutation review (validator)
  assertion-quality         # assertion depth review (validator)
  test-anti-patterns        # severity-ranked smell scan (validator)
)
# .NET authoring depth: loaded by the implementer when the target is .NET.
skills+=(
  scaffold-dotnet-test-project
  writing-mstest-tests
  writing-tunit-tests
  tunit-mocking
)

for s in "${skills[@]}"; do
  if [[ ! -d "$src/$s" ]]; then
    echo "warn: $src/$s missing, skipping" >&2
    continue
  fi
  mkdir -p "$here/skills/$s"
  rsync -a --delete --exclude '__pycache__' "$src/$s/" "$here/skills/$s/"
  echo "synced $s"
done

(cd "$repo" && git rev-parse HEAD) > "$here/skills/UPSTREAM_COMMIT" 2>/dev/null || true
echo "upstream commit recorded in skills/UPSTREAM_COMMIT"
