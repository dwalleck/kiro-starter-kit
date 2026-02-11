# Review Notes

## Consistency Check

### ✅ Consistent Patterns Found
- All 8 worker agents use identical tool sets: `["fs_read", "fs_write", "execute_bash", "grep", "code"]`
- All agents reference the same model: `claude-opus-4-6`
- All agents share the same 3 resources: `AGENTS.md`, `README.md`, `.editorconfig`
- All agent configs use `$schema: "../../agent-schema.json"` for validation
- All prompts begin with the same scoping line: "The scope of this review are the files passed via the query and relevant_context."
- The orchestrator's `availableAgents` and `trustedAgents` lists match exactly and include all 8 worker agents

### ⚠️ Minor Inconsistencies
1. **Orchestrator prompt references `gh pr view`** but `gh` CLI is not listed as a dependency or prerequisite anywhere. Users without GitHub CLI installed may encounter errors.
2. **code-simplifier prompt references specific JS/TS conventions** (ES modules, arrow functions, React patterns) but the agent description is language-agnostic. This could confuse users applying it to non-JS/TS projects.
3. **Resource files don't exist in the repo** — `AGENTS.md`, `README.md`, and `.editorconfig` are referenced by all agents but are not included in the starter kit. Users need to create these in their target project.

## Completeness Check

### ✅ Well-Documented Areas
- Each agent has a clear, detailed system prompt with structured output formats
- The orchestrator prompt thoroughly documents the workflow, agent selection criteria, and aggregation format
- Agent selection criteria are well-defined (when to use each agent)
- The agent schema is comprehensive with descriptions for all fields

### ⚠️ Gaps Identified

1. **No README.md** — The repository has no README explaining what the starter kit is, how to install/use it, or prerequisites.

2. **No AGENTS.md** — While all agents reference this file as a resource, there's no example or template showing what it should contain.

3. **No .editorconfig** — Referenced as a resource but not included.

4. **No usage instructions** — No documentation on how to:
   - Install the agents into a Kiro CLI project
   - Configure the agents for a specific codebase
   - Customize agent prompts for project-specific needs
   - Run the orchestrator for the first time

5. **No example output** — No sample of what a complete orchestrated review looks like.

6. **No customization guide** — No guidance on:
   - How to add new specialized agents
   - How to modify existing agent prompts
   - How to adjust confidence thresholds or severity levels
   - How to disable specific agents

7. **`.kiro/prompts/` directory is empty** — Its purpose is unclear. May be reserved for user-defined prompts vs. agent prompts.

8. **No versioning strategy** — No indication of how the starter kit will be versioned or updated.

## Recommendations

1. **Create a README.md** with installation instructions, prerequisites, and quick-start guide
2. **Create a template AGENTS.md** showing the expected format for project guidelines
3. **Include a sample .editorconfig** as a starting point
4. **Add a CONTRIBUTING.md** explaining how to add or modify agents
5. **Document the `gh` CLI as an optional dependency** in the orchestrator prompt or README
6. **Clarify the code-simplifier's language scope** — either make it language-agnostic or document it as JS/TS-focused
7. **Add example output** showing a complete review cycle
8. **Document the empty `.kiro/prompts/` directory** purpose
