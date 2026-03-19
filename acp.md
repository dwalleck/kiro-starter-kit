## Protocol Details
- **Protocol**: JSON-RPC 2.0 over stdio
- **Transport**: stdin (client→agent), stdout (agent→client)
- **Specification**: ACP v2025-01-01
- **Implementation**: sacp Rust crate

## Advertised Capabilities
During initialize, the Kiro ACP agent advertises:
- loadSession: true - Supports loading existing sessions
- promptCapabilities.image: true - Supports image content in prompts

## Core ACP Methods
| Method | Description |
|--------|-------------|
| initialize | Initialize the connection and exchange capabilities |
| session/new | Create a new chat session |
| session/load | Load an existing session by ID |
| session/prompt | Send a prompt to the agent |
| session/cancel | Cancel the current operation |
| session/set_mode | Switch agent mode (e.g., different agent configs) |
| session/set_model | Change the model for the session |

## Session Update Types
Sent via session/notification:
- AgentMessageChunk - Streaming text/content from the agent
- ToolCall - Tool invocation with name, parameters, status
- ToolCallUpdate - Progress updates for running tools
- TurnEnd - Signals the agent turn has completed

## Kiro Extension Methods

Requests (client→agent):
- _kiro.dev/commands/execute - Execute a slash command
- _kiro.dev/commands/options - Get autocomplete options for a command

Notifications (agent→client):
- _kiro.dev/commands/available - Lists available commands after session creation
- _kiro.dev/mcp/oauth_request - OAuth URL for MCP server authentication
- _kiro.dev/mcp/server_initialized - MCP server finished initializing
- _kiro.dev/compaction/status - Context compaction progress
- _kiro.dev/clear/status - Session clear status
- _session/terminate - Terminate a subagent session

## Session Persistence
- Location: ~/.kiro/sessions/cli/
- Format: Two files per session:
  - <session-id>.json - Session metadata and state
  - <session-id>.jsonl - Event log (conversation history)

## Logging
- macOS: $TMPDIR/kiro-log/kiro-chat.log
- Linux: /tmp/kiro-log/logs/kiro-chat.log
- Control via: KIRO_LOG_LEVEL=debug and KIRO_CHAT_LOG_FILE=/path/to/custom.log

That's all the detail available in the documentation. No schemas, parameter
details, or implementation examples are provided. For complete protocol
specifications, the docs reference [agentclientprotocol.com](https://
agentclientprotocol.com/get-started/introduction).


