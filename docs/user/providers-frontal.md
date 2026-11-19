# Frontal Code

Frontal Code is an early-access provider integration. Install the Frontal Code
CLI on the T3 server and enable it in **Settings → Providers**.

## Install and authenticate

Install Frontal Code using the instructions in the
[Frontal Code repository](https://github.com/frontal-labs/code). The binary is
usually named `frontal-code`; the `code` binary is also accepted. If it is not
on the server's `PATH`, set **Binary path** in the provider instance settings.

Authentication is owned by Frontal Code. Use its documented `code login` flow,
or configure `FRONTAL_API_KEY` and, when needed, `FRONTAL_BASE_URL` in the
provider instance. Anthropic, OpenAI, and xAI credentials can be supplied as
instance environment variables as well. Bedrock, Azure OpenAI, and Ollama
credentials or endpoints are available in the same per-instance environment
section.

## Permission modes

T3 maps **Supervised** to Frontal's `prompt` mode, **Auto-accept edits** to
`workspace-write`, and **Full access** to `danger-full-access`. The current
Frontal JSON interface cannot send live approval requests back to T3, so a
turn that needs an interactive permission prompt may fail rather than opening a
T3 approval card. Use an explicit native permission mode appropriate for the
workspace.

## Current limitations

Frontal's JSON command emits one final turn summary rather than streamed
events. T3 therefore cannot currently show individual Frontal tool calls,
tool output, file diffs, MCP tools, or approval requests as they happen. T3
keeps a bounded synthetic conversation history for turns in the same live
session, but does not claim native resume after a server restart. Steering,
queued messages, fork, rollback, and subagent tracking are unavailable.

The provider is intentionally off by default while Frontal's machine protocol
stabilizes.
