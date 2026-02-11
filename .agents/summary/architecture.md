# System Architecture

## Architectural Pattern: Orchestrator–Worker Agent System

The kiro-starter-kit implements a hierarchical multi-agent architecture where a central orchestrator delegates specialized review tasks to independent worker agents that execute in parallel.

```mermaid
graph TD
    User[User / Developer] -->|"review request"| RO[review-orchestrator]
    
    RO -->|"delegates via use_subagent"| CR[code-reviewer]
    RO -->|"delegates via use_subagent"| CS[code-simplifier]
    RO -->|"delegates via use_subagent"| CA[comment-analyzer]
    RO -->|"delegates via use_subagent"| PTA[pr-test-analyzer]
    RO -->|"delegates via use_subagent"| SFH[silent-failure-hunter]
    RO -->|"delegates via use_subagent"| TDA[type-design-analyzer]
    RO -->|"delegates via use_subagent"| PCR[pci-compliance-reviewer]
    RO -->|"delegates via use_subagent"| PR[performance-reviewer]
    
    CR -->|"findings"| RO
    CS -->|"findings"| RO
    CA -->|"findings"| RO
    PTA -->|"findings"| RO
    SFH -->|"findings"| RO
    TDA -->|"findings"| RO
    PCR -->|"findings"| RO
    PR -->|"findings"| RO
    
    RO -->|"aggregated summary"| User

    style RO fill:#f9a825,stroke:#f57f17,color:#000
    style User fill:#e3f2fd,stroke:#1565c0,color:#000
```

## Design Principles

1. **Separation of Concerns**: Each agent has a single, well-defined review domain (security, performance, types, etc.)
2. **Declarative Configuration**: Agents are defined via JSON config files referencing markdown prompts — no imperative code
3. **Parallel Execution**: The orchestrator can invoke up to 4 agents simultaneously, batching when more are needed
4. **Shared Context Model**: All agents share the same resource files (`AGENTS.md`, `README.md`, `.editorconfig`) for project-level context
5. **Uniform Tooling**: All worker agents share the same tool set (`fs_read`, `fs_write`, `execute_bash`, `grep`, `code`); only the orchestrator additionally has `use_subagent`

## Execution Flow

```mermaid
sequenceDiagram
    participant U as User
    participant O as review-orchestrator
    participant W as Worker Agents (1..N)

    U->>O: Request review
    O->>O: Determine scope (git diff / status)
    O->>O: Select applicable agents
    O->>W: Invoke batch 1 (up to 4 agents)
    W-->>O: Return findings
    O->>W: Invoke batch 2 (if needed)
    W-->>O: Return findings
    O->>O: Aggregate results by severity
    O-->>U: Unified PR Review Summary
    O->>W: Invoke code-simplifier (final polish)
    W-->>O: Simplification suggestions
    O-->>U: Final recommendations
```

## Configuration Architecture

```mermaid
graph LR
    Schema[agent-schema.json] -->|"validates"| Config["*.json agent configs"]
    Config -->|"references"| Prompt["prompts/*.md"]
    Config -->|"declares"| Tools["Tool permissions"]
    Config -->|"declares"| Resources["Shared resources"]
    Config -->|"declares"| Model["AI model selection"]
    
    OConfig[review-orchestrator.json] -->|"declares"| SubAgents["toolsSettings.subagent"]
    SubAgents -->|"availableAgents"| Config
    SubAgents -->|"trustedAgents"| Config

    style Schema fill:#e8f5e9,stroke:#2e7d32,color:#000
    style OConfig fill:#f9a825,stroke:#f57f17,color:#000
```

Each agent configuration follows a consistent structure:
- `$schema`: Points to `agent-schema.json` for validation
- `name`: Unique agent identifier
- `description`: Human-readable purpose
- `prompt`: `file://` reference to a markdown system prompt
- `model`: AI model to use (all use `claude-opus-4-6`)
- `tools`: Array of permitted tool names
- `resources`: Shared context files loaded into the agent
