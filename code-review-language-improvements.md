# Code Review Language Improvements

Companion to `multi-agent-code-review`. Documents ways to give a reviewing agent more precise direction — both about *which diff* to review and *which tools* to use while exploring code. Each entry uses problem/symptom/why/solution form so it stands alone, and the doc can grow as new failure modes surface.

---

# Part 1 — Specifying the diff to review

**Core failure mode:** natural-language ref names ("the release branch", "diff against staging") are lossy. Agents resolve them through training-data priors — which often point at the *conceptual* branch (whatever a repo usually ships from) rather than the *literal* ref the user meant. A PR URL or an explicit SHA bypasses this; in their absence, an explicit preflight does.

## Problem: "Diff against the <X> branch" picks the wrong ref

**Symptom:** User says "diff this against the release branch." Agent diffs against `main`, even though a branch literally named `release` exists.

**Why it happens:** "Release branch" is a concept in most repos — the branch you ship from. The model resolves the phrase to the conceptual referent, not the string. Same trap with "staging," "integration," "dev," "next."

**Solution:** Before computing any diff, the agent enumerates real refs and echoes back the exact one it will use.

```bash
git fetch --all --prune
git branch -a
git tag --list
```

Then state plainly: *"I will diff against `origin/release` (commit `<sha>`). Confirm before I proceed."*

If the user's phrase doesn't match a real ref verbatim, stop and ask — do not infer.

---

## Problem: No PR exists yet (local-only branch)

**Symptom:** User wants a review of work-in-progress on a feature branch before opening a PR. There is no PR URL to anchor the diff.

**Why it matters:** Without a PR, every ambiguity from the previous problem applies, plus there's no authoritative `baseRefName` to fall back on.

**Solution:** Have the user (or the agent) state three things explicitly:

1. The base ref — full name, e.g. `origin/release`, not "release"
2. The head ref — usually `HEAD` or the current branch name
3. Whether to use two-dot (`base..head`) or three-dot (`base...head`) diff semantics

Default to three-dot (`git diff base...head`) — it diffs from the *merge base*, which is what reviewers almost always mean. Two-dot includes upstream changes that aren't part of the user's work.

---

## Problem: PR URL is provided but the PR was retargeted

**Symptom:** PR was opened against `main`, then retargeted to `release/v3` mid-flight. Or the user pasted the wrong PR number. The agent reviews against the wrong base.

**Why it happens:** A PR URL is authoritative, but only if you actually fetch the metadata. Reviewing without confirming `baseRefName` and head SHA assumes correctness instead of verifying it.

**Solution:** Before reading any code, fetch and echo:

```bash
gh pr view <n> --json baseRefName,headRefName,headRefOid,title,state
```

State back: *"PR #<n> targets `<baseRefName>` from `<headRefName>` at `<headRefOid>`. Title: `<title>`. Proceed?"*

This also catches closed/merged PRs where reviewing is no longer meaningful.

---

## Problem: Stacked PRs or merge-from-main commits pollute the diff

**Symptom:** PR's diff contains hundreds of files the author didn't touch — merges from main, or commits from a parent PR in a stack.

**Why it happens:** Two-dot diff (`base..head`) shows everything reachable from head but not base, including unrelated upstream commits that landed via merges.

**Solution:** Use three-dot diff against the merge base:

```bash
git merge-base <base> <head>          # find the fork point
git diff <base>...<head>              # three-dot uses merge base implicitly
```

For stacked PRs, diff against the *parent PR's head*, not `main`. Confirm the parent ref with the user before assuming.

---

## Problem: Force-pushed branch — local view is stale

**Symptom:** Agent reviews an old version of the branch because the local ref hasn't been updated after a force-push.

**Why it happens:** `git fetch` doesn't run automatically. Local `origin/feature-x` may point at a SHA that's no longer on the remote.

**Solution:** Always `git fetch --all --prune` before resolving refs, and prefer remote refs (`origin/feature-x`) over local ones. For PRs, fetch the PR head explicitly and verify:

```bash
git fetch origin pull/<n>/head:pr-<n>
git log -1 pr-<n>                     # confirm the SHA matches what gh reports
```

---

## Problem: Azure DevOps PR — no `gh` equivalent

**Symptom:** Skill assumes GitHub. ADO PRs need different commands and the response shape differs (iterations, threads instead of reviews/comments).

**Solution:** Use `az repos pr show` or the REST API:

```bash
az repos pr show --id <n> \
  --query "{base:targetRefName, head:sourceRefName, headSha:lastMergeSourceCommit.commitId, status:status}"
```

`targetRefName` and `sourceRefName` come back as `refs/heads/<name>` — strip the prefix when echoing back to the user. ADO has no `position`-based inline-comment model; comments are file+line `threads`. Posting comments programmatically is meaningfully harder than on GitHub — produce a report and let the user post it manually unless automated posting was explicitly requested.

---

## Universal preflight (Part 1)

Regardless of platform or PR state, before reviewing:

1. `git fetch --all --prune`
2. Resolve and echo the exact base ref and head SHA
3. Confirm with the user if anything was inferred rather than stated
4. Use three-dot diff semantics by default
5. Only then begin reading code

---

# Part 2 — Choosing exploration tools (LSP vs grep)

**Core principle:** LSP and grep answer fundamentally different questions. LSP answers *semantic* questions ("what does this symbol resolve to, who calls this method, who implements this interface"). Grep answers *textual* questions ("where does this string appear"). They're complements, not substitutes — picking one wholesale leaves blind spots either way.

## Problem: Grep-based caller discovery is semantically wrong

**Symptom:** Reviewer greps for `ReverseTransaction` to find callers. Match list includes overrides on unrelated types, comments mentioning the method, log strings, and unrelated methods that happen to share the name. Real callers via interface dispatch or generic substitution may be missed entirely.

**Why it happens:** Grep is textual; method dispatch is semantic. Same name on a different type is a false positive; an interface call resolved to a generic implementation is a false negative.

**Solution:** Use LSP `find references` (and `find implementations` for interfaces) for caller discovery. Fall back to grep only when LSP is unavailable, and *say so explicitly* in the review so the human knows the caller list is best-effort rather than authoritative.

---

## Problem: Type and signature questions can't be answered textually

**Symptom:** Agent assumes a parameter is `List<T>` because the variable name is `list`, then flags a "missing null check" that's actually impossible because the real type is `IReadOnlyList<T>` from a non-nullable context. Or the reverse — misses a real bug because it can't see that the parameter is nullable.

**Why it happens:** Grep gives you text, not types. Inferring types from names or surrounding code is guesswork, and guesses become confident-sounding findings.

**Solution:** When type information matters for a finding (nullability, mutability, generic substitution, async/sync, ref/value semantics), resolve via LSP hover or go-to-definition. If LSP is unavailable, downgrade the finding to a question rather than a claim ("Is this nullable? If so, ...").

---

## Problem: Silently broken LSP looks identical to "no results"

**Symptom:** LSP server crashed, lost workspace context, or never indexed the file. `find references` returns empty. Agent reports "no callers found" with high confidence — but the symbol has dozens of real callers.

**Why it happens:** Empty results from a healthy LSP and empty results from a broken LSP are indistinguishable in the response. There's no `status: degraded` flag.

**Solution:** Before relying on LSP results, smoke-test it — query a known-existing symbol (a well-known framework type, or a symbol the agent just navigated to) and confirm a sensible response. If the smoke test fails or the workspace clearly hasn't indexed, treat LSP as unavailable for the rest of the review and fall back to grep with an explicit note in the output.

---

## Problem: String-based references are invisible to LSP

**Symptom:** Agent uses LSP `find references` on a public class and reports the rename is safe. In production, a runtime DI registration by name, a reflection lookup, a JSON deserialization target, and a YAML config key all break.

**Why it happens:** LSP only knows about references the language can statically resolve. String-based references — reflection, DI by name, route templates, serialization keys, log message templates — are invisible by design.

**Solution:** When reviewing public APIs, type names, or anything that might be referenced by string, *combine* LSP find-references with a textual grep for the same name across the repo (and, when relevant, configs, docs, and infrastructure files). Treat the two passes as additive, not redundant.

---

## Tool selection policy (Part 2)

For any review, before exploring code:

1. **Caller / implementer / definition questions → LSP first.** Fall back to grep only on failure, and disclose the fallback in the review.
2. **Type and signature questions → LSP only.** Don't infer types from text; downgrade findings to questions if LSP is unavailable.
3. **Textual, config, and cross-repo questions → grep.** LSP doesn't cover these.
4. **Public APIs, type names, or string-keyed identifiers → LSP *and* grep.** DI containers, reflection, route templates, and serialization keys are common blind spots that an LSP-only review will miss.
5. **Smoke-test LSP before trusting empty results.** A broken LSP returning empty looks identical to "no references exist" — that's the worst-case failure mode for a reviewer.
