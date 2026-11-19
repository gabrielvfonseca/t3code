# Frontal Code provider design

## Protocol decision

Frontal Code 0.1.1 does not expose ACP, a session RPC transport, or a streamed
JSONL protocol. Its source tree includes `code-api`, but `/v1/prompt` and
`/v1/cli/run` wait for a child process to finish and return stdout/stderr plus
the final JSON value; they do not provide turn events, session attachment, or
approval callbacks. The supported local machine-readable surface is therefore
the one-shot command:

```text
frontal-code --output-format json prompt "..."
```

That command waits for the complete turn and prints one JSON summary. Frontal's
interactive permission prompter reads a terminal, so it cannot be connected to
T3's live approval callbacks. The initial T3 integration therefore uses a
native one-shot adapter. Each T3 turn is a short-lived process; the adapter
keeps a bounded conversation handoff in memory while the session is alive.

The adapter deliberately does not advertise ACP-only or streaming features. It
does not claim native resume after a server restart, steering, fork/rollback,
subagents, MCP injection, tool events, or approvals. A future Frontal JSONL or
ACP surface can replace this transport without changing the provider settings
or client registration.

The recorder at `apps/server/scripts/record-frontal-replay-fixture.ts` captures
the raw one-shot process envelope for protocol regression. It is not registered
with the shared orchestration replay harness because the current Frontal
surface has no replayable event frames.

## Capability matrix

| Surface                   | T3 behavior                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Text turns                | Supported after the process exits and the JSON summary parses                                                             |
| Tool calls and diffs      | Not individually observable in the current Frontal JSON mode                                                              |
| Permissions               | Maps T3 mode to Frontal `read-only`, `workspace-write`, `prompt`, or `danger-full-access`; live approvals are unavailable |
| Stop                      | Sends SIGINT to the active one-shot process                                                                               |
| Continuity                | Bounded synthetic history is injected into later prompts in the same adapter session                                      |
| Native resume             | Not claimed; Frontal's CLI parser does not accept a prompt after `--resume`                                               |
| Steering, queueing        | Not supported                                                                                                             |
| Fork/rollback             | Not supported                                                                                                             |
| Subagents/background work | Not surfaced                                                                                                              |
| MCP                       | Not injected; the one-shot interface has no T3 MCP callback channel                                                       |
| Usage limits              | Not classified from the current summary; failures remain provider errors                                                  |

The provider is disabled by default. Status checks only run `--version`; they
do not start a session, MCP, hooks, login, or permission prompt.

## Authentication and isolation

The client exposes Frontal, Anthropic, OpenAI, xAI, Bedrock, Azure OpenAI, and
Ollama credential/endpoint variables as per-instance environment fields. The
adapter strips those ambient credentials and AWS credentials before applying the
instance's configured values. `FRONTAL_CODE_HOME` and
`FRONTAL_CODE_CONFIG_HOME` can isolate Frontal state per provider instance.
