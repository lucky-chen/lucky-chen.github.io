---
title: "Agent Engineering: SDK Requirements and Runtime Architecture"
categories: [AI, Engineering]
date: 2025-12-22
permalink: /2025/12/07/ai/agent_sdk_design_en/
---

# Background

**Chinese version: [Agent 工程：SDK 需求拆解与运行时架构](/i18n/zh/ai/agent-sdk-design.html)**

This article uses an agent SDK as a hands-on introduction to AI application engineering through the following runtime and orchestration requirements:

- Runtime execution
- API boundaries
- Orchestration and execution control
- Context management
- Tool integration
- Model integration
- Permissions
- Observability

<!-- more -->

# Requirement Definition and Decomposition

The SDK is designed to meet the following runtime requirements:

- **Runtime execution**: Manage session lifecycles, multi-turn execution, runtime state, and result updates.
- **API boundaries**: Provide stable session and execution interfaces while allowing internal implementations to change.
- **Orchestration and execution control**: Select execution paths and handle stopping conditions, failures, and state updates.
- **Context management**: Keep conversation history, stage memory, and retrieval results distinct; assemble and trim context within a budget.
- **MCP / tool integration**: Register and discover tools, dispatch calls, and execute them.
- **Permissions**: Check whether an operation is allowed and constrain its execution environment.
- **Model integration**: Adapt provider APIs to a consistent interface for model calls and outputs.
- **Execution records**: Record execution steps, tool calls, failures, and resource use for debugging.
- **Extensibility**: Define interfaces for retrieval, memory, checkpoints, compression, and multi-agent support.

# Architecture Design

## Overall Architecture

The SDK separates APIs, lifecycle control, orchestration, context, tools, model integration, observability, and persistence into the layers below.

```text
+----------------------------+
|        Application         |
| terminal / external app    |
+----------------------------+
             |
             v
+----------------------------+
|         Interface          |
| session / agent api        |
+----------------------------+
             |
             v
+----------------------------+
|    Runtime Controller      |
| lifecycle / execution      |
+----------------------------+
             |
             v
+----------------------------+
|    Agent Orchestration     |
| chat / ReAct / peo         |
+----------------------------+
     |            |            \
      v            v             v
+-------------+ +-------------+ +------------------+
|   Context   | | Capability  | |      Model       |
| Management  | | and Tooling | |   Integration    |
+-------------+ +-------------+ +------------------+
       \                            /
        \                          /
         v                        v
     +-------------------------------+
     |         Observability         |
     |       trace / metrics         |
     +-------------------------------+
              |             \
              v              v
     +--------------------------------+
     |            Data Layer          |
     |      storage / persistence     |
     +--------------------------------+
```

## Application Layer

Responsibilities:

- Provide terminal and application entry points that handle user input/output and call the runtime.

Modules:

- `TerminalSessionDemo`: Read terminal input, call runtime APIs, and display results.
- External Application Integrations: Connect external applications or host systems to the SDK.

## Interface Layer

Responsibilities:

- Expose stable session and execution APIs without exposing runtime internals.

Modules:

- `Api`: Define the public SDK interface.
- `RuntimeApi`: Provide APIs to create, open, and close sessions.
- `ISession`: Provide session access, state queries, and execution methods.
- Agent / Session API Contracts: Define how applications call agent and session APIs.

## Runtime Controller Layer

Responsibilities:

- Manage session lifecycles, execution, and runtime state.
- Schedule runs and normalize their results.

Modules:

- `Runtime`: Initialize the runtime, manage session lifecycles, and dispatch requests.
- `AgentSession`: Execute requests within a session, update state, and normalize results.
- `RunCheckpoint`: Define an interface for checkpoints, resuming runs, and background execution.

## Agent Orchestration Layer

Responsibilities:

- Select an execution mode based on the request and runtime state.

Modules:

- `AgentSelector`: Select an execution mode.
- `ChatAgent`: Handle direct conversational requests.
- `ReActAgent`: Iterate through tool calls and use observations to guide execution.
- `PEOAgent`: Run the plan-execute-observe stages.
- `MultiAgentProtocol`: Define a protocol interface for future multi-agent collaboration.

## Context Management Layer

Responsibilities:

- Manage conversation history, stage memory, and retrieval results.
- Assemble and trim context within the available budget.

Modules:

- `SessionTranscript`: Store conversation history for subsequent turns.
- `RuntimeMemory`: Store agent memory, including stage memory and summaries.
- `RetrievalProvider`: Retrieve context from external sources.
- `ContextAssembler`: Assemble context from multiple sources.
- `ContextBudgetPolicy`: Apply context budgets and trimming policies.

## Capability and Tooling Layer

Responsibilities:

- Register and discover tools, dispatch calls, and execute them.
- Check permissions and constrain tool execution environments.

Modules:

- `McpGateway`: Receive and dispatch tool calls.
- `McpToolRegistry`: Register, discover, and look up tools.
- `RuntimePermissionPolicy`: Check permissions and capability restrictions before execution.
- `ExecutionEnvironment`: Define local, sandboxed, and remote execution environments.

## Model Integration Layer

Responsibilities:

- Provide a consistent interface for model calls and outputs across providers.

Modules:

- `ModelFactory`: Create model instances and select an integration method.
- Provider Adapters: Adapt provider-specific APIs.
- `StreamingEventAdapter`: Normalize streaming events and outputs.

## Observability Layer

Responsibilities:

- Record events, call traces, and metrics for debugging and diagnostics.

Modules:

- `Trace`: Record execution events and call traces.
- `Metrics`: Collect runtime metrics, resource use, and call statistics.
- Diagnostics / Usage: Provide diagnostics and usage records.

## Data Layer

Responsibilities:

- Persist transcripts, memory, checkpoints, traces, and metrics through a shared storage interface.

Modules:

- `Storage`: Define the persistence interface.
- File / Remote Persistence Backends: Implement file-based or remote storage.

# Current Implementation Status

| Layer | Module | Status | Notes |
| --- | --- | --- | --- |
| `Application Layer` | `TerminalSessionDemo` | Basic implementation | Terminal entry point for manual runs and session-flow checks. |
| `Interface Layer` | `Api` / `RuntimeApi` / `ISession` | Basic implementation | Session-oriented APIs are available. |
| `Interface Layer` | `AgentApi` / `IAgent` | Basic implementation | Direct agent calls complement the session APIs. |
| `Runtime Controller Layer` | `Runtime` / `AgentSession` | Basic implementation | Supports session lifecycles, execution, state updates, and result normalization; more complex run control remains unfinished. |
| `Runtime Controller Layer` | `RunCheckpoint` | Partially complete | Checkpoint interfaces exist; resume, retry, and background execution remain unfinished. |
| `Agent Orchestration Layer` | `AgentSelector` / intent routing | Partially complete | Supports execution-mode selection. |
| `Agent Orchestration Layer` | `ChatAgent` / `ReActAgent` / `PEOAgent` | Basic implementation | All three execution modes are implemented. |
| `Agent Orchestration Layer` | `MultiAgentProtocol` | Reserved for extension | Protocol reserved; not integrated into the current execution flow. |
| `Context Management Layer` | `SessionTranscript` / `RuntimeMemory` / `ContextAssembler` / `ContextBudgetPolicy` | Partially complete | Supports history, stage memory, context assembly, and budgeting; handling of complex scenarios remains incomplete. |
| `Context Management Layer` | `RetrievalProvider` | Partially complete | Retrieval interface defined; the full retrieval / RAG flow remains unfinished. |
| `Capability and Tooling Layer` | `McpGateway` / `McpToolRegistry` / `RuntimePermissionPolicy` / `ExecutionEnvironment` | Basic implementation | Supports tool integration, dispatch, permission checks, and execution environment definitions. |
| `Model Integration Layer` | `ModelFactory` / `StreamingEventAdapter` | Basic implementation | Supports consistent model calls and streaming-event adaptation. |
| `Model Integration Layer` | Provider Adapters | Partially complete | Mock and current providers are connected; provider coverage is limited. |
| `Observability Layer` | `Trace` / `Metrics` | Basic implementation | Records key events and metrics during execution. |
| `Observability Layer` | Diagnostics / Usage | Partially complete | Basic execution records exist; a complete diagnostic view is not implemented. |
| `Data Layer` | `Storage` / File Persistence | Basic implementation | Storage interfaces and file persistence are implemented. |
| `Data Layer` | Remote Persistence Backends | Reserved for extension | Interface reserved; remote storage is not implemented. |

# Design Principles and Comparisons

## SDK Design Principles

- **Separate the runtime from business logic**: The SDK manages sessions, execution, and integrations; applications define tasks and business rules.
- **Centralize execution control**: Route tool calls through registration, dispatch, permission checks, and execution environment constraints.
- **Keep context sources distinct**: Maintain transcripts, agent memory, and retrieval separately, then use the context budget to select inputs for each turn.

## Criteria for Comparing Agent SDKs

- **Run control**: Session lifecycles, execution modes, state updates, stopping, and recovery.
- **Feature coverage**: Tool and model integrations, multi-agent support, long-term memory, and permission policies.
- **Operations**: Tracing, persistence, and reliability in complex scenarios.

This project focuses on runtime layers and API responsibilities. Recovery, retries, background execution, multi-agent support, and remote persistence remain unfinished; see the status table above.

## Connections to Previous Engineering Experience

Established engineering practices still apply:

- Define requirements and separate SDK responsibilities from application responsibilities.
- Use stable APIs to isolate internal changes.
- Separate execution control, integrations, and persistence.

Agent systems also require attention to:

- **Variable LLM outputs**: Output variation affects execution control, debugging, and result validation.
- **Changing context**: Select inputs for each turn from history, memory, and retrieval results within a budget; decide what to retain, compress, or remove.
- **Dynamic execution paths**: Choose tools, subsequent steps, and stopping conditions at runtime.
- **External operations**: Check permissions, constrain tool execution environments, and record results and state changes when accessing external systems.

# Scope and Limitations

This article documents the runtime design and recorded implementation status. Basic implementations, partial implementations, and reserved extensions do not establish production readiness.

For the wider technology map, see [Getting Started with AI: A Four-Layer Technology Map](/2025/12/07/ai/ai_overview_en/). Model development and inference infrastructure are separate topics in that overview.
