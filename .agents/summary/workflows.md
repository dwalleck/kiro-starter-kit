# Workflows

## Primary Workflow: Orchestrated PR Review

```mermaid
flowchart TD
    A[User requests review] --> B[Orchestrator determines scope]
    B --> C{How to determine scope?}
    C -->|"git diff"| D[Identify changed files]
    C -->|"git status"| D
    C -->|"gh pr view"| D
    D --> E[Classify file types]
    E --> F[Select applicable agents]
    
    F --> G{More than 4 agents?}
    G -->|No| H[Invoke all in parallel]
    G -->|Yes| I[Batch into groups of 4]
    I --> H
    
    H --> J[Collect findings from batch]
    J --> K{More batches?}
    K -->|Yes| H
    K -->|No| L[Aggregate results by severity]
    
    L --> M[Present unified summary]
    M --> N{Issues found?}
    N -->|Yes| O[User fixes issues]
    O --> P[Re-run specific reviews]
    P --> L
    N -->|No| Q[Run code-simplifier as final polish]
    Q --> R[Present final recommendations]
```

## Agent Selection Logic

```mermaid
flowchart TD
    Start[Changed Files Identified] --> CR[Always: code-reviewer]
    
    Start --> TestCheck{Test files changed or new functionality?}
    TestCheck -->|Yes| PTA[pr-test-analyzer]
    
    Start --> CommentCheck{Comments/docs modified?}
    CommentCheck -->|Yes| CA[comment-analyzer]
    
    Start --> ErrorCheck{Error handling changed?}
    ErrorCheck -->|Yes| SFH[silent-failure-hunter]
    
    Start --> TypeCheck{Types added/modified?}
    TypeCheck -->|Yes| TDA[type-design-analyzer]
    
    Start --> PaymentCheck{Payment/card/encryption code?}
    PaymentCheck -->|Yes| PCR[pci-compliance-reviewer]
    
    Start --> PerfCheck{Data processing/DB/loops/resources?}
    PerfCheck -->|Yes| PR[performance-reviewer]
    
    CR & PTA & CA & SFH & TDA & PCR & PR --> Batch[Batch and invoke]
    Batch --> Aggregate[Aggregate results]
    Aggregate --> CS[code-simplifier — runs last]
```

## Agent Invocation Workflow

Each worker agent follows this internal workflow:

1. **Receive scope** — File paths and focus areas from orchestrator
2. **Analyze changes** — Use `git diff`, `fs_read`, `code` tools to examine the code
3. **Apply domain expertise** — Evaluate against domain-specific criteria defined in the prompt
4. **Generate structured findings** — Produce findings in the agent's defined output format
5. **Return to orchestrator** — Findings are collected and aggregated

## Result Aggregation Workflow

The orchestrator aggregates all agent findings into a unified summary:

```mermaid
flowchart LR
    A[Agent 1 findings] --> Agg[Aggregate & Deduplicate]
    B[Agent 2 findings] --> Agg
    C[Agent N findings] --> Agg
    
    Agg --> Critical[Critical Issues]
    Agg --> Important[Important Issues]
    Agg --> Suggestions[Suggestions]
    Agg --> Strengths[Strengths]
    
    Critical & Important & Suggestions & Strengths --> Summary[Unified PR Review Summary]
```

## Adding a New Agent Workflow

To add a new specialized review agent:

1. Create `.kiro/agents/prompts/<agent-name>.md` with the system prompt
2. Create `.kiro/agents/<agent-name>.json` with the agent configuration
3. Add the agent name to `review-orchestrator.json` → `toolsSettings.subagent.availableAgents` and `trustedAgents`
4. Update the orchestrator prompt (`.kiro/agents/prompts/review-orchestrator.md`) to describe when to use the new agent
