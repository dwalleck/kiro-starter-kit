# Codebase Information

## Project Identity

- **Name**: kiro-starter-kit
- **Type**: Kiro CLI Agent Configuration Starter Kit
- **Purpose**: A collection of pre-built, specialized AI agent configurations for the Kiro CLI, focused on orchestrated PR code review workflows
- **Repository**: Git-managed, single commit (`3bcc066` — "Adding conversion of Claude PR toolkit to Kiro agents")

## Technology Stack

| Category | Technology |
|---|---|
| Platform | Kiro CLI (AI assistant framework by AWS) |
| Configuration Format | JSON (agent definitions, schemas) |
| Prompt Format | Markdown (agent system prompts) |
| Schema Standard | JSON Schema (Draft 2020-12) |
| AI Model | Claude Opus 4 (`claude-opus-4-6`) |
| Version Control | Git |

## File Statistics

| Category | Count |
|---|---|
| Total files (non-git) | 21 |
| Agent configuration files (.json) | 9 |
| Agent prompt files (.md) | 9 |
| Schema files (.json) | 2 |
| Settings files (.json) | 1 |

## Languages & Formats

- **JSON**: Agent configs, schemas, LSP settings
- **Markdown**: Agent system prompts
- **No application source code**: This is a configuration-only repository

## Key Directories

```
.kiro/
├── agents/           # Agent JSON configs + prompts/
│   ├── *.json        # 9 agent configuration files
│   └── prompts/      # 9 agent system prompt markdown files
├── prompts/          # Empty (reserved for future use)
└── settings/
    └── lsp.json      # LSP configuration for code intelligence
```
