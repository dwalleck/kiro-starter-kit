# Data Models

## Agent Configuration Model

Defined by `agent-schema.json` (JSON Schema Draft 2020-12).

```mermaid
classDiagram
    class Agent {
        +string name*
        +string? description
        +string? prompt
        +string? model
        +string[] tools
        +string[] allowedTools
        +ResourcePath[] resources
        +Map~string,CustomToolConfig~ mcpServers
        +Map~string,string~ toolAliases
        +Map~string,Hook[]~ hooks
        +Map~string,object~ toolsSettings
        +boolean useLegacyMcpJson
        +string? keyboardShortcut
        +string? welcomeMessage
    }

    class CustomToolConfig {
        +string? type
        +string? url
        +Map~string,string~ headers
        +OAuthConfig? oauth
        +string? command
        +string[] args
        +Map~string,string~? env
        +uint64 timeout
        +boolean disabled
        +string[] disabledTools
    }

    class OAuthConfig {
        +string? redirectUri
        +string[]? oauthScopes
    }

    class Hook {
        +string command*
        +uint64 timeout_ms
        +uint max_output_size
        +uint64 cache_ttl_seconds
        +string? matcher
    }

    class ComplexResource {
        +string type*
        +string source*
        +string? name
        +string? description
        +IndexType? indexType
        +string[]? include
        +string[]? exclude
        +boolean? autoUpdate
    }

    class IndexType {
        <<enumeration>>
        fast
        best
    }

    Agent --> "0..*" CustomToolConfig : mcpServers
    Agent --> "0..*" Hook : hooks
    Agent --> "0..*" ComplexResource : resources
    CustomToolConfig --> "0..1" OAuthConfig : oauth
    ComplexResource --> "0..1" IndexType : indexType
```

### Required Fields
- `name` — Only required field; all others have defaults

### Key Relationships
- `ResourcePath` is a union type: plain string path, `file://` URI, or `ComplexResource` object
- `toolsSettings` is a free-form map keyed by tool name — the orchestrator uses it for `subagent.availableAgents` and `subagent.trustedAgents`
- `tools` array references tool names; MCP server tools use `@{SERVER_NAME}/tool_name` syntax

## Orchestrator Subagent Settings Model

The `review-orchestrator` uses a specialized `toolsSettings.subagent` structure:

```json
{
  "availableAgents": ["<agent-name>", ...],
  "trustedAgents": ["<agent-name>", ...]
}
```

- `availableAgents`: Agents the orchestrator can invoke
- `trustedAgents`: Agents that can execute without user confirmation

## Agent Output Models

Each agent produces structured output following its prompt-defined format. These are not formal schemas but consistent markdown structures:

| Agent | Output Structure |
|---|---|
| code-reviewer | Issues grouped by severity (Critical 90–100, Important 80–89) with confidence scores |
| code-simplifier | Refined code with documented changes |
| comment-analyzer | Critical Issues, Improvement Opportunities, Recommended Removals, Positive Findings |
| pr-test-analyzer | Summary, Critical Gaps, Important Improvements, Test Quality Issues, Positive Observations |
| silent-failure-hunter | Issues with Location, Severity, Description, Hidden Errors, User Impact, Recommendation |
| type-design-analyzer | Per-type ratings (Encapsulation, Expression, Usefulness, Enforcement) each 1–10 |
| pci-compliance-reviewer | PCI Compliance Summary with findings by requirement and compliance status |
| performance-reviewer | Issues with Location, Severity, Category, Impact Estimate, Recommendation |
| review-orchestrator | Aggregated PR Review Summary: Critical Issues, Important Issues, Suggestions, Strengths |
